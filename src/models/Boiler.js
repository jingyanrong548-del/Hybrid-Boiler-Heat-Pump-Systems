// src/models/Boiler.js
import { FUEL_DB } from '../core/constants.js';
// [v9.1] 引入物理计算函数
import { calculateActualFlueVolume, calculateAdjustedDewPoint, calculateWaterCondensation } from '../core/physics.js';

export class Boiler {
    constructor(config) {
        // config: { fuelType, efficiency, loadKW, flueIn, flueOut, excessAir, fuelCalValue, fuelCo2Value... }
        this.config = config;
        
        // 1. 加载默认燃料数据
        const defaultData = FUEL_DB[config.fuelType] || FUEL_DB['NATURAL_GAS'];
        const fuelUnit = defaultData.unit; // 保存燃料单位，用于日志输出
        
        // 2. 创建副本以避免污染原始常量
        this.fuelData = { ...defaultData };
        
        // 3. [v9.1.1] 应用高级参数覆盖 (来自 System.js 清洗后的有效值)
        // 注意: 我们假定 System.js 和 main.js 已经确保传入的 fuelCalValue 单位与 constants.js 定义的 MJ 基准一致
        if (config.fuelCalValue !== undefined && !isNaN(config.fuelCalValue)) {
            this.fuelData.calorificValue = config.fuelCalValue;
        }
        
        // 🔧 修复：CO2因子单位转换
        // 如果用户输入的是 kg/kWh 单位，需要转换为 kg/unit
        // 或者，如果输入值明显是按kWh当量的值（对于天然气，0.2左右），也需要转换
        if (config.fuelCo2Value !== undefined && !isNaN(config.fuelCo2Value)) {
            let co2Factor = config.fuelCo2Value;
            const fuelCo2Unit = config.fuelCo2Unit || 'kgCO2/unit';
            const calorificValue = this.fuelData.calorificValue; // MJ/unit
            const defaultCo2Factor = defaultData.co2Factor; // 默认CO2因子 (kg/unit)
            
            // 判断是否需要转换：
            // 1. 单位明确是 kg/kWh
            // 2. 或者：单位是 kg/unit，但输入值明显是按kWh当量的值（小于默认值的1/5，且小于1.0）
            const isUnitKWh = fuelCo2Unit === 'kgCO2/kWh';
            const isLikelyKWhValue = !isUnitKWh && 
                                     co2Factor < 1.0 && 
                                     co2Factor < defaultCo2Factor * 0.3; // 如果输入值远小于默认值，很可能是kWh当量
            
            if (isUnitKWh || isLikelyKWhValue) {
                // 转换公式：co2Factor_kg_per_unit = co2Factor_kg_per_kWh × (calorificValue_MJ_per_unit / 3.6)
                // 因为 1 kWh = 3.6 MJ，所以需要乘以 (calorificValue / 3.6)
                const originalValue = co2Factor;
                co2Factor = co2Factor * (calorificValue / 3.6);
                
                const reason = isUnitKWh ? "单位是kg/kWh" : "检测到输入值可能是kWh当量";
                console.log(`🔧 CO2因子单位转换:`, {
                    "原始值": originalValue,
                    "原始单位": fuelCo2Unit,
                    "转换原因": reason,
                    "默认CO2因子": defaultCo2Factor.toFixed(4) + " kg/" + fuelUnit,
                    "热值": calorificValue + " MJ/" + fuelUnit,
                    "转换公式": `${originalValue} kg/kWh × (${calorificValue} MJ/${fuelUnit} / 3.6 MJ/kWh)`,
                    "转换后值": co2Factor.toFixed(4),
                    "转换后单位": "kg/" + fuelUnit
                });
            } else {
                // 单位已经是 kg/unit，且值合理，直接使用
                console.log(`🔧 CO2因子使用:`, {
                    "值": co2Factor,
                    "单位": fuelCo2Unit,
                    "燃料单位": fuelUnit,
                    "默认值": defaultCo2Factor.toFixed(4) + " kg/" + fuelUnit
                });
            }
            
            this.fuelData.co2Factor = co2Factor;
        }
    }

    getCalorificValue() {
        return this.fuelData.calorificValue; 
    }

    calculateBaseline(fuelPrice) {
        // 1. 计算热输入功率 (kW)
        const inputKW = this.config.loadKW / this.config.efficiency;
        
        // 2. [v9.1.1 FIX] 计算燃料消耗速率
        // 公式: FuelRate = Energy_Input_MJ_per_Hour / LHV_MJ_per_Unit
        // 转换: 1 kW = 3.6 MJ/h
        const inputEnergyMJ = inputKW * 3.6; 
        const fuelRate = inputEnergyMJ / this.getCalorificValue();
        
        // 验证:
        // - 电直热: LHV=3.6 MJ/kWh. Rate = (kW * 3.6) / 3.6 = kW (kWh/h). [正确]
        // - 天然气: LHV=36.0 MJ/m3. Rate = (kW * 3.6) / 36 = kW / 10 (m3/h). [正确]
        
        return {
            inputKW,
            fuelRate,
            costPerHour: fuelRate * fuelPrice,
            co2PerHour: fuelRate * this.fuelData.co2Factor // 注意: co2Factor 单位是 kg/unit
        };
    }

    /**
     * 计算烟气余热理论潜力 (v9.1 动态修正版)
     */
    calculateSourcePotential() {
        // 针对无烟气的燃料（如电力），直接返回空潜力
        if (this.config.fuelType === 'ELECTRICITY') {
            return {
                sensible: 0,
                latent: 0,
                total: 0,
                flowVol: 0,
                dewPoint: 0,
                flueIn: this.config.flueIn,
                flueOut: this.config.flueOut
            };
        }

        const { loadKW, efficiency, flueIn, flueOut, excessAir } = this.config;
        const inputKW = loadKW / efficiency;
        
        // 1. [v9.1] 计算实际烟气量 (考虑过量空气系数 Alpha)
        const alpha = excessAir || 1.2;
        
        const actualFlueFactor = calculateActualFlueVolume(
            this.fuelData.theoreticalGasFactor,
            this.fuelData.theoreticalAirNeed,
            alpha
        );

        // 🔧 烟气体积流量计算 (m3/h)
        // 参考状态：标准状态 (0°C, 101.325 kPa, STP)
        // 注意: theoreticalGasFactor 是标准状态下 m3_gas / m3_fuel
        // 我们需要先算出 m3_fuel / h (即 fuelRate，但这里为了解耦重新计算)
        // 这里的 fuelRate 必须基于体积(m3)或质量(kg)，取决于 fuelData.unit
        // 为简化模型，我们沿用 inputKW * Factor 的工程估算 (假设 Factor 已经归一化到 kW 输入)
        // [修正]: 更严谨的做法是使用 CalculateBaseline 中的 fuelRate。
        // 但为了保持无状态调用，我们近似认为 actualFlueFactor 是 "m3/h per Input kW" ? 
        // 不，CONSTANTS 里定义的 Factor 是 per unit fuel。
        // 所以: FlueVol = FuelRate * Factor
        
        const inputEnergyMJ = inputKW * 3.6;
        const fuelRate = inputEnergyMJ / this.getCalorificValue();
        // 🔧 体积流量：标准状态 (0°C, 101.325 kPa) 下的体积
        const flueGasVol = fuelRate * actualFlueFactor; 

        // 🔧 体积比热容：0.00038 kWh/(m3·K) 是标准状态下烟气的平均体积比热容
        // 由于体积流量是标准状态的，而显热计算需要实际工况，这里使用工程近似值
        // 该值已考虑了实际工况（100-200°C范围）的平均效应
        const Cp_flue = 0.00038; // 简化比热容 (kWh/m3K)

        // 2. 显热计算 (Sensible)
        const sensible = flueGasVol * Cp_flue * (flueIn - flueOut);

        // 3. [v9.1] 潜热计算 (Latent) - 基于动态露点
        let latent = 0;
        
        // 计算经稀释后的实际露点
        const actualDewPoint = calculateAdjustedDewPoint(
            this.fuelData.dewPointRef,
            alpha
        );
        
        // 只有当 排烟温度 < 实际露点 时，才产生潜热
        let waterCondensation = null;
        if (flueOut < actualDewPoint) {
            let maxLatentRatio = 0.0;
            // 简单的燃料潜热比例估算
            if (this.config.fuelType === 'NATURAL_GAS') maxLatentRatio = 0.11;
            else if (this.config.fuelType === 'BIOMASS') maxLatentRatio = 0.08;

            const maxLatentKW = inputKW * maxLatentRatio;
            
            // 线性插值模型：(露点 -> 5度) 对应 (0% -> 100% 潜热释放)
            let condFactor = (actualDewPoint - flueOut) / (actualDewPoint - 5);
            if (condFactor > 1) condFactor = 1;
            if (condFactor < 0) condFactor = 0;
            
            latent = maxLatentKW * condFactor;
            
            // 🔧 新增：计算水分析出量
            // 估算烟气中水蒸气体积百分比（基于燃料类型和过量空气系数）
            let h2oVolPercent = 0;
            const alpha = excessAir || 1.2;
            
            if (this.config.fuelType === 'NATURAL_GAS') {
                // 天然气：CH4 + 2O2 -> CO2 + 2H2O
                // 理论：1 m3 CH4 -> 1 m3 CO2 + 2 m3 H2O + 7.52 m3 N2
                const theoCO2 = 1.0;
                const theoH2O = 2.0;
                const theoN2 = 7.52;
                const excessO2 = (alpha - 1.0) * 2.0;
                const excessN2 = (alpha - 1.0) * 7.52;
                const totalVol = theoCO2 + theoH2O + theoN2 + excessO2 + excessN2;
                h2oVolPercent = (theoH2O / totalVol) * 100;
            } else if (this.config.fuelType === 'COAL') {
                h2oVolPercent = 8.0;
            } else if (this.config.fuelType === 'DIESEL') {
                h2oVolPercent = 12.0;
            } else {
                h2oVolPercent = 10.0; // 默认值
            }
            
            // 计算水分析出量
            waterCondensation = calculateWaterCondensation(
                flueIn,
                flueOut,
                flueGasVol,
                h2oVolPercent,
                actualDewPoint
            );
        }

        return {
            sensible,
            latent,
            total: sensible + latent,
            flowVol: flueGasVol,
            dewPoint: actualDewPoint, // 返回动态露点供 UI 显示
            flueIn,
            flueOut,
            waterCondensation: waterCondensation // 🔧 新增：返回水分析出数据
        };
    }
}
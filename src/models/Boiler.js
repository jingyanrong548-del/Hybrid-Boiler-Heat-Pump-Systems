// src/models/Boiler.js
import { FUEL_DB } from '../core/constants.js';
// [v9.1] 引入物理计算函数
import { calculateActualFlueVolume, calculateAdjustedDewPoint } from '../core/physics.js';

export class Boiler {
    constructor(config) {
        // config: { fuelType, efficiency, loadKW, flueIn, flueOut, excessAir, fuelCalValue, fuelCo2Value... }
        this.config = config;
        
        // 1. 加载默认燃料数据
        const defaultData = FUEL_DB[config.fuelType] || FUEL_DB['NATURAL_GAS'];
        
        // 2. 创建副本以避免污染原始常量
        this.fuelData = { ...defaultData };
        
        // 3. [v9.1.1] 应用高级参数覆盖 (来自 System.js 清洗后的有效值)
        // 注意: 我们假定 System.js 和 main.js 已经确保传入的 fuelCalValue 单位与 constants.js 定义的 MJ 基准一致
        if (config.fuelCalValue !== undefined && !isNaN(config.fuelCalValue)) {
            this.fuelData.calorificValue = config.fuelCalValue;
        }
        
        if (config.fuelCo2Value !== undefined && !isNaN(config.fuelCo2Value)) {
            this.fuelData.co2Factor = config.fuelCo2Value;
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

        // 实际工况下的烟气体积流量 (m3/h)
        // 注意: theoreticalGasFactor 是 m3_gas / m3_fuel
        // 我们需要先算出 m3_fuel / h (即 fuelRate，但这里为了解耦重新计算)
        // 这里的 fuelRate 必须基于体积(m3)或质量(kg)，取决于 fuelData.unit
        // 为简化模型，我们沿用 inputKW * Factor 的工程估算 (假设 Factor 已经归一化到 kW 输入)
        // [修正]: 更严谨的做法是使用 CalculateBaseline 中的 fuelRate。
        // 但为了保持无状态调用，我们近似认为 actualFlueFactor 是 "m3/h per Input kW" ? 
        // 不，CONSTANTS 里定义的 Factor 是 per unit fuel。
        // 所以: FlueVol = FuelRate * Factor
        
        const inputEnergyMJ = inputKW * 3.6;
        const fuelRate = inputEnergyMJ / this.getCalorificValue();
        const flueGasVol = fuelRate * actualFlueFactor; 

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
        if (flueOut < actualDewPoint) {
            let maxLatentRatio = 0.0;
            // 简单的燃料潜热比例估算
            if (this.config.fuelType === 'NATURAL_GAS') maxLatentRatio = 0.11;
            else if (this.config.fuelType === 'BIOMASS') maxLatentRatio = 0.08;

            const maxLatentKW = inputKW * maxLatentRatio;
            
            // 线性插值模型：(露点 -> 30度) 对应 (0% -> 100% 潜热释放)
            let condFactor = (actualDewPoint - flueOut) / (actualDewPoint - 30);
            if (condFactor > 1) condFactor = 1;
            if (condFactor < 0) condFactor = 0;
            
            latent = maxLatentKW * condFactor;
        }

        return {
            sensible,
            latent,
            total: sensible + latent,
            flowVol: flueGasVol,
            dewPoint: actualDewPoint, // 返回动态露点供 UI 显示
            flueIn,
            flueOut
        };
    }
}
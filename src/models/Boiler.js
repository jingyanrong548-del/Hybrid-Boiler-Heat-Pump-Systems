// src/models/Boiler.js
import { FUEL_DB } from '../core/constants.js';
// [v9.1] 引入新的物理计算函数
import { calculateActualFlueVolume, calculateAdjustedDewPoint } from '../core/physics.js';

export class Boiler {
    constructor(config) {
        // config: { fuelType, efficiency, loadKW, flueIn, flueOut, excessAir, fuelCalValue, fuelCo2Value... }
        this.config = config;
        
        // 1. 加载默认燃料数据
        const defaultData = FUEL_DB[config.fuelType] || FUEL_DB['NATURAL_GAS'];
        
        // 2. 创建副本以避免污染原始常量
        this.fuelData = { ...defaultData };
        
        // 3. [v9.1 FIX] 应用高级参数覆盖
        // 注意: 我们假设前端输入的值已经匹配了内部计算需要的单位 (例如 LHV 对应 MJ/unit 或 kWh/unit)
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
        const inputKW = this.config.loadKW / this.config.efficiency;
        const fuelRate = inputKW / this.getCalorificValue();
        
        return {
            inputKW,
            fuelRate,
            costPerHour: fuelRate * fuelPrice,
            co2PerHour: inputKW * this.fuelData.co2Factor
        };
    }

    /**
     * 计算烟气余热理论潜力 (v9.1 动态修正版)
     */
    calculateSourcePotential() {
        const { loadKW, efficiency, flueIn, flueOut, excessAir } = this.config;
        const inputKW = loadKW / efficiency;
        
        // 1. [v9.1] 计算实际烟气量 (考虑过量空气系数 Alpha)
        // 如果没有传入 excessAir，默认取 1.2
        const alpha = excessAir || 1.2;
        
        const actualFlueFactor = calculateActualFlueVolume(
            this.fuelData.theoreticalGasFactor,
            this.fuelData.theoreticalAirNeed,
            alpha
        );

        // 实际工况下的烟气体积流量 (m3/h)
        const flueGasVol = inputKW * actualFlueFactor; 
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
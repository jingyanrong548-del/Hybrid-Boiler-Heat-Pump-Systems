// src/core/physics.js
import { LIMITS, UNIT_CONVERTERS } from './constants.js';

/**
 * 根据绝对压力计算饱和温度 (R134a/Water 简化拟合)
 * @param {number} pressureMPa - 绝对压力 (MPa)
 * @returns {number} 饱和温度 (°C)
 */
export function getSatTempFromPressure(pressureMPa) {
    if (pressureMPa <= 0) return 100;
    // Antoine Equation approximation for engineering range
    const P_mmHg = pressureMPa * 7500.62;
    const A = 8.07131, B = 1730.63, C = 233.426;
    const val = B / (A - Math.log10(P_mmHg)) - C;
    return parseFloat(val.toFixed(1));
}

/**
 * 估算 R134a 的饱和压力 (用于计算压比)
 * @param {number} tempC - 温度 (°C)
 * @returns {number} 压力 (MPa)
 */
export function estimateSatPressureR134a(tempC) {
    return 0.2928 * Math.exp(0.035 * tempC); 
}

/**
 * 估算焓值 (简化工程模型)
 * @param {number} tempC - 温度
 * @param {boolean} isSteam - 是否为蒸汽状态
 * @returns {number} 焓值 (kJ/kg)
 */
export function estimateEnthalpy(tempC, isSteam = false) {
    if (!isSteam) {
        return 4.187 * tempC; // Cp_water ≈ 4.187
    } else {
        return 2676 + 0.5 * (tempC - 100); // 饱和蒸汽基准 + 过热
    }
}

/**
 * 将蒸吨转换为 kW
 * @param {number} tons - 蒸吨数
 * @returns {number} 功率 (kW)
 */
export function convertSteamTonsToKW(tons) {
    if (tons <= 0) return 0;
    return parseFloat((tons * UNIT_CONVERTERS.TON_TO_KW).toFixed(1));
}

/**
 * 归一化热值计算
 */
export function normalizeCalorific(val, unit, converterMap) {
    const factor = converterMap[unit] || 1.0;
    return val / factor; 
}

// === [v9.1 新增] 高级物理修正函数 ===

/**
 * 计算实际烟气生成量 (考虑过量空气)
 * 公式: V_actual = V_theo + (alpha - 1) * V_air_theo
 * @param {number} theoGas - 理论烟气量 (alpha=1)
 * @param {number} theoAir - 理论需气量
 * @param {number} alpha - 过量空气系数 (e.g. 1.2)
 * @returns {number} 实际烟气量 (m3/unit_fuel)
 */
export function calculateActualFlueVolume(theoGas, theoAir, alpha) {
    // 安全检查
    const safeAlpha = Math.max(1.0, alpha || 1.2);
    
    // 额外引入的空气量
    const excessAirVolume = (safeAlpha - 1.0) * theoAir;
    
    return theoGas + excessAirVolume;
}

/**
 * 计算修正后的露点温度
 * 原理: 过量空气增加 -> 水蒸气分压降低 -> 露点下降
 * 工程近似: 每增加 0.1 的 alpha，露点约下降 1.5~2.0°C
 * @param {number} refDewPoint - 基准露点 (alpha=1.0)
 * @param {number} alpha - 当前过量空气系数
 * @returns {number} 修正后的露点 (°C)
 */
export function calculateAdjustedDewPoint(refDewPoint, alpha) {
    if (!refDewPoint || refDewPoint <= 0) return 0;
    
    const safeAlpha = Math.max(1.0, alpha || 1.2);
    
    // 衰减系数 K (经验值)
    const K_DECAY = 17.0; 
    
    // T_dp = T_ref - K * (alpha - 1)
    const adjusted = refDewPoint - K_DECAY * (safeAlpha - 1.0);
    
    return parseFloat(adjusted.toFixed(1));
}

/**
 * 计算水蒸气的饱和压力 (Antoine方程)
 * @param {number} tempC - 温度 (°C)
 * @returns {number} 饱和压力 (kPa)
 */
export function calculateWaterVaporSaturationPressure(tempC) {
    // Antoine方程: log10(P) = A - B/(C + T)
    // 对于水: A=8.07131, B=1730.63, C=233.426 (T in °C, P in mmHg)
    const A = 8.07131;
    const B = 1730.63;
    const C = 233.426;
    const T = tempC;
    
    const log10P_mmHg = A - B / (C + T);
    const P_mmHg = Math.pow(10, log10P_mmHg);
    const P_kPa = P_mmHg * 0.133322; // 1 mmHg = 0.133322 kPa
    
    return P_kPa;
}

/**
 * 计算烟气冷却过程中的水分析出量
 * @param {number} flueInTemp - 初始排烟温度 (°C)
 * @param {number} flueOutTemp - 最终排烟温度 (°C)
 * @param {number} flueVolFlow - 烟气体积流量 (m³/h, 标准状态)
 * @param {number} h2oVolPercent - 烟气中水蒸气体积百分比 (%)
 * @param {number} dewPoint - 露点温度 (°C)
 * @returns {Object} {condensedWater: 析出水量 (kg/h), initialWater: 初始水蒸气量 (kg/h), finalWater: 最终水蒸气量 (kg/h)}
 */
export function calculateWaterCondensation(flueInTemp, flueOutTemp, flueVolFlow, h2oVolPercent, dewPoint) {
    // 如果最终温度 >= 露点，没有水分析出
    if (flueOutTemp >= dewPoint) {
        return {
            condensedWater: 0,
            initialWater: 0,
            finalWater: 0
        };
    }
    
    // 标准状态参数
    const T_STP = 273.15; // 0°C = 273.15 K
    const P_STP = 101.325; // 标准大气压 (kPa)
    const R = 0.287; // 干空气气体常数 (kJ/(kg·K))
    const R_H2O = 0.4615; // 水蒸气气体常数 (kJ/(kg·K))
    
    // 1. 计算初始水蒸气质量
    // 水蒸气体积流量 (标准状态)
    const h2oVolFlow_STP = flueVolFlow * (h2oVolPercent / 100);
    
    // 水蒸气在标准状态下的密度 (kg/m³)
    // 理想气体状态方程: ρ = P / (R * T)
    const h2oDensity_STP = P_STP / (R_H2O * T_STP); // kg/m³
    const initialWater = h2oVolFlow_STP * h2oDensity_STP; // kg/h
    
    // 2. 计算最终温度下的饱和水蒸气分压
    const satPressure = calculateWaterVaporSaturationPressure(flueOutTemp); // kPa
    
    // 3. 计算初始水蒸气分压
    const initialWaterVaporPressure = P_STP * (h2oVolPercent / 100); // kPa
    
    // 4. 计算最终温度下的水蒸气分压
    // 当温度低于露点时，水蒸气会凝结，最终分压等于该温度下的饱和压力
    // 但不能超过初始分压（如果饱和压力大于初始分压，说明没有凝结）
    const finalWaterVaporPressure = Math.min(satPressure, initialWaterVaporPressure);
    
    // 5. 计算最终温度下的水蒸气质量
    // 🔧 修复：正确计算最终水蒸气质量
    // 
    // 物理过程：当温度低于露点时，水蒸气会凝结，最终的水蒸气分压等于该温度下的饱和压力
    // 
    // 正确方法：基于烟气总体积计算最终水蒸气质量
    // 假设烟气总体积（包括干烟气和水蒸气）在最终温度下 = flueVolFlow * (最终温度/初始温度)
    // 最终水蒸气体积（在最终温度下）= 烟气总体积 * (最终分压 / 总压)
    //                                = flueVolFlow * (最终温度/初始温度) * (最终分压 / P_STP)
    // 
    // 最终水蒸气质量 = 最终分压 * 最终水蒸气体积 / (R_H2O * 最终温度)
    //                = 最终分压 * [flueVolFlow * (最终温度/初始温度) * (最终分压 / P_STP)] / (R_H2O * 最终温度)
    //                = 最终分压^2 * flueVolFlow / (R_H2O * P_STP * 初始温度)
    //                = 最终分压^2 * flueVolFlow / (R_H2O * P_STP * T_STP)
    
    const T_final_K = flueOutTemp + 273.15;
    
    // 🔧 修复：使用基于烟气总体积的计算方法
    // 最终水蒸气质量 = 最终分压^2 * 烟气总体积 / (R_H2O * 总压 * 初始温度)
    const finalWater = (finalWaterVaporPressure * finalWaterVaporPressure * flueVolFlow) / 
                       (R_H2O * P_STP * T_STP); // kg/h
    
    // 5. 计算析出的水量
    const condensedWater = Math.max(0, initialWater - finalWater);
    
    return {
        condensedWater: parseFloat(condensedWater.toFixed(2)),
        initialWater: parseFloat(initialWater.toFixed(2)),
        finalWater: parseFloat(finalWater.toFixed(2))
    };
}
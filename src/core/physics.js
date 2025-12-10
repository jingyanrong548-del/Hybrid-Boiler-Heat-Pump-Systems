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
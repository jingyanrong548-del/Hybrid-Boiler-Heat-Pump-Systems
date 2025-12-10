// src/core/cycles.js
import { MODES, STRATEGIES, RECOVERY_TYPES, LIMITS } from './constants.js';
import { estimateSatPressureR134a } from './physics.js';

/**
 * 统一 COP 计算引擎 (Single Source of Truth)
 * @param {Object} params
 * @param {number} params.evapTemp - 蒸发温度 (Source Out + delta)
 * @param {number} params.condTemp - 冷凝温度 (Target + delta)
 * @param {number} params.efficiency - 热力完善度 (0.0 - 1.0)
 * @param {string} params.mode - MODES.WATER | MODES.STEAM
 * @param {string} params.strategy - STRATEGIES.PREHEAT | STRATEGIES.GEN
 * @param {string} params.recoveryType - RECOVERY_TYPES.MVR | RECOVERY_TYPES.ABS
 * @returns {Object} { cop, lift, error }
 */
export function calculateCOP(params) {
    const { evapTemp, condTemp, efficiency, mode, strategy, recoveryType } = params;

    // 1. 基础物理检查
    if (evapTemp < LIMITS.MIN_EVAP_TEMP) return { cop: 1.0, error: "蒸发温度过低" };
    if (condTemp > LIMITS.MAX_COND_TEMP) return { cop: 1.0, error: "冷凝温度过高" };
    
    // 2. 温升 (Lift) 计算
    const lift = condTemp - evapTemp;
    if (lift <= LIMITS.MIN_LIFT_DELTA) return { cop: 8.0, lift, error: "温差过小" }; // 软限制

    // === 分支 A: 吸收式热泵 (Absorption) ===
    if (recoveryType === RECOVERY_TYPES.ABS) {
        // [修复逻辑]：如果是蒸汽模式，但策略是补水预热，本质上还是加热水，COP 应较高 (1.7)
        // 只有在直接产生蒸汽 (GEN) 时，COP 才会降低到 1.45
        if (mode === MODES.STEAM && strategy === STRATEGIES.GEN) {
            return { cop: 1.45, lift, error: null };
        } else {
            // 热水模式 或 蒸汽补水预热模式
            return { cop: 1.70, lift, error: null }; 
        }
    }

    // === 分支 B: 电动热泵 (MVR/Compressor) ===
    // 1. 卡诺循环基准
    const T_evap_K = evapTemp + 273.15;
    const T_cond_K = condTemp + 273.15;
    let copCarnot = T_cond_K / (T_cond_K - T_evap_K);
    
    // 物理极值限制
    if (copCarnot > 15) copCarnot = 15;

    // 2. 温升惩罚 (Lift Penalty)
    // 之前 Logic 与 Chart 不一致的根源在这里。现在统一封装。
    let liftPenalty = 1.0;
    
    // 如果是大温升工况 (>80K)，且确实是在生产蒸汽，效率衰减
    if (mode === MODES.STEAM && strategy === STRATEGIES.GEN && lift > 80) {
        liftPenalty = 0.85; 
    }

    // 3. 最终计算
    // COP = Carnot * 完善度 * 惩罚因子
    let realCop = copCarnot * efficiency * liftPenalty;

    // 4. 边界清洗
    if (realCop < 1.0) realCop = 1.0;
    if (realCop > 8.0) realCop = 8.0;

    return { 
        cop: parseFloat(realCop.toFixed(2)), 
        lift: parseFloat(lift.toFixed(1)),
        error: null
    };
}
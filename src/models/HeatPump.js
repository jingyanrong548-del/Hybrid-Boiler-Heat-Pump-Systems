// src/models/HeatPump.js
import { calculateCOP } from '../core/cycles.js';
import { STRATEGIES, MODES, RECOVERY_TYPES } from '../core/constants.js';
import { estimateEnthalpy } from '../core/physics.js';

export class HeatPump {
    constructor(config) {
        // config: { recoveryType, mode, strategy, perfectionDegree, totalLoadKW, isManualCop, manualCop }
        this.config = config;
    }

    /**
     * 执行热泵物理仿真 (Flow-Driven Mode)
     * @param {Object} sourcePotential - 热源侧能力 { total, flueIn, flueOut, flowVol, ... }
     * @param {Object} thermalDemand - 热汇侧需求 { loadIn, massFlow, targetTemp }
     */
    simulate(sourcePotential, thermalDemand) {
        const { flueIn: targetFlueIn, flueOut: targetFlueOut, flowVol, Cp_flue } = sourcePotential; 
        
        // targetTemp 是系统的最终目标 (如 60C 或 160C 饱和温度)，作为热泵加热的物理上限
        const { loadIn, massFlow, targetTemp: sysFinalTarget } = thermalDemand;
        const { mode, strategy, recoveryType, perfectionDegree, isManualCop, manualCop } = this.config;

        if (targetFlueOut === undefined) return { error: "Internal Error: Target Flue Out missing" };
        if (!massFlow || massFlow <= 0) return { error: "Internal Error: System Mass Flow invalid" };

        // === 1. 物理边界界定 (Physics Constraints) ===
        // [v9.1.4 Logic Update] 
        // 针对蒸汽预热工况，热汇能力受限于水的沸点 (防止气蚀或沸腾)
        // 无论系统最终产生多少压力的蒸汽，热泵在预热段只能加热到 <100°C
        const SAFE_PREHEAT_LIMIT = 98.0; 
        
        let effectiveTargetTemp = sysFinalTarget;
        
        if (mode === MODES.STEAM && strategy === STRATEGIES.PREHEAT) {
            // 如果系统目标 > 98，强制钳制热泵侧目标为 98 (或用户设定的 loadOut，此处简化为硬限)
            if (effectiveTargetTemp > SAFE_PREHEAT_LIMIT) {
                effectiveTargetTemp = SAFE_PREHEAT_LIMIT;
            }
        }

        // === 2. 温度设定 ===
        // 蒸发温度: 目标排烟温度 - 5K
        const tEvap = targetFlueOut - 5.0; 
        
        // 冷凝温度: 基于有效的加热目标 + 5K
        // 如果触发了 98度限制，这里也会随之降低，从而提升 COP (符合物理事实)
        const tCond = effectiveTargetTemp + 5.0; 
        
        // === 3. 计算 COP ===
        let perfData;
        if (isManualCop && manualCop > 0) {
            perfData = { cop: manualCop, lift: tCond - tEvap, error: null };
        } else {
            perfData = calculateCOP({
                evapTemp: tEvap,
                condTemp: tCond,
                efficiency: perfectionDegree,
                mode,
                strategy,
                recoveryType
            });
        }
        if (perfData.error) return perfData;

        // === 4. 计算实际回收热量 (Q_rec) ===
        
        // 限制 A: 烟气侧最大能力 (Source Limit)
        // 假设能把排烟降到 targetFlueOut (例如 30C)
        const maxEvapHeat = sourcePotential.total;
        
        // 转换为热泵输出热量 (MVR: Q_out = Q_evap * COP / (COP - 1))
        const copRatio = (perfData.cop > 1) ? (perfData.cop / (perfData.cop - 1)) : 1.0;
        const qSourceLimit = maxEvapHeat * copRatio;

        // 限制 B: 热汇侧最大需求 (Sink Limit)
        // [v9.1.4] 使用 effectiveTargetTemp (98°C) 计算焓差
        // 这决定了水流量(massFlow)最多能吃下多少热量而不沸腾
        const h_limit = estimateEnthalpy(effectiveTargetTemp, false); // 始终是液态水
        const h_in = estimateEnthalpy(loadIn, false);
        const qSinkLimit = massFlow * (h_limit - h_in);

        // 最终回收热量 (取两者较小值)
        // 如果 qSinkLimit 很小 (蒸汽工况流量小)，这里就会被截断
        const recoveredHeat = Math.min(qSourceLimit, qSinkLimit);
        
        // === 5. 驱动能耗计算 ===
        const driveEnergy = recoveredHeat / perfData.cop;

        // === 6. 反算热泵实际出水温度 (Actual Load Out) ===
        const deltaH = recoveredHeat / massFlow; // kJ/kg
        const h_out_actual = h_in + deltaH;
        let actualLoadOut = h_out_actual / 4.187; // 简化反算
        
        // 边界保护
        if (actualLoadOut > effectiveTargetTemp) actualLoadOut = effectiveTargetTemp;

        // === 7. [核心] 反算实际排烟温度 (Actual Flue Out) ===
        // 如果受 Sink 限制 (水吃不下)，烟气就不用降那么多温，排烟温度会升高
        
        // 计算实际需要的蒸发吸热量
        const qEvapActual = (recoveryType === RECOVERY_TYPES.MVR) 
            ? (recoveredHeat - driveEnergy) 
            : (recoveredHeat / copRatio); 

        let actualFlueOut;
        
        // 判断瓶颈位置
        // 注意：浮点数比较增加 tolerance
        if (qEvapActual >= sourcePotential.total - 0.1) {
            // 热源被榨干 (Source Limited) -> 排烟温度降至最低
            actualFlueOut = targetFlueOut;
        } else {
            // 热源有富余 (Sink Limited) -> 反算排烟温度
            // Q_actual = Flow_gas * Cp * (T_in - T_out_actual)
            // => T_out_actual = T_in - Q_actual / (Flow * Cp)
            const deltaT = qEvapActual / (flowVol * Cp_flue);
            actualFlueOut = targetFlueIn - deltaT;
            
            // 安全限制: 排烟温度不可能高于入口
            if (actualFlueOut > targetFlueIn) actualFlueOut = targetFlueIn;
        }

        return {
            cop: perfData.cop,
            lift: perfData.lift,
            recoveredHeat, 
            driveEnergy,   
            // 状态标记: 如果回收热量显著小于源侧极限，则为 Sink Limited
            isSinkLimited: (recoveredHeat < qSourceLimit - 1.0),
            actualLoadOut: parseFloat(actualLoadOut.toFixed(1)), // 实际水温
            actualFlueOut: parseFloat(actualFlueOut.toFixed(1))  // 实际排烟
        };
    }
}
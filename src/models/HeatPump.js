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
        
        // [v9.1 Update] 接收系统计算好的质量流量 massFlow (kg/s)
        // targetTemp 是系统的最终目标 (如 60C 或 160C 饱和温度)，作为热泵加热的物理上限
        const { loadIn, massFlow, targetTemp: sysFinalTarget } = thermalDemand;
        const { mode, strategy, recoveryType, perfectionDegree, isManualCop, manualCop } = this.config;

        if (targetFlueOut === undefined) return { error: "Internal Error: Target Flue Out missing" };
        if (!massFlow || massFlow <= 0) return { error: "Internal Error: System Mass Flow invalid" };

        // --- 1. 温度设定 ---
        // 蒸发温度: 目标排烟温度 - 5K
        const tEvap = targetFlueOut - 5.0; 
        
        // 冷凝温度 (估算): 
        // 在串联预热模型中，热泵冷凝温度是滑动的。
        // 为保守起见（选型安全），我们假设冷凝温度需要应对系统最高目标 (targetTemp + 5K)。
        const tCond = sysFinalTarget + 5.0; 
        
        // --- 2. 计算 COP ---
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

        // --- 3. 计算实际回收热量 (Q_rec) ---
        
        // 限制 A: 烟气侧最大能力 (Source Limit)
        // sourcePotential.total 是将排烟降至 targetFlueOut 所释放的能量
        const maxEvapHeat = sourcePotential.total;
        
        // 转换为热泵输出热量
        // MVR: Q_out = Q_evap * COP / (COP - 1)
        const copRatio = (perfData.cop > 1) ? (perfData.cop / (perfData.cop - 1)) : 1.0;
        const qSourceLimit = maxEvapHeat * copRatio;

        // 限制 B: 热汇侧最大需求 (Sink Limit)
        // 热泵不能把水加热超过系统的最终目标温度 (防止沸腾或超温)
        // Q_sink_limit = 流量 * (系统目标焓 - 入口焓)
        const h_sys_target = estimateEnthalpy(sysFinalTarget, mode === MODES.STEAM);
        const h_in = estimateEnthalpy(loadIn, false);
        const qSinkLimit = massFlow * (h_sys_target - h_in);

        // 最终回收热量 (取两者较小值)
        const recoveredHeat = Math.min(qSourceLimit, qSinkLimit);
        
        // --- 4. 驱动能耗计算 ---
        const driveEnergy = recoveredHeat / perfData.cop;

        // --- 5. [核心] 反算热泵实际出水温度 (Actual Load Out) ---
        // 逻辑: Q_rec = massFlow * (h_out_actual - h_in)
        // h_out_actual = h_in + Q_rec / massFlow
        const deltaH = recoveredHeat / massFlow; // kJ/kg
        const h_out_actual = h_in + deltaH;
        
        // 将焓值转回温度 (简化处理: 水的 Cp=4.187)
        // 对于预热阶段，工质始终是液态水
        let actualLoadOut = h_out_actual / 4.187;
        
        // 边界保护
        if (actualLoadOut > sysFinalTarget) actualLoadOut = sysFinalTarget;

        // --- 6. 反算实际排烟温度 (Actual Flue Out) ---
        // 逻辑: 如果受 Sink 限制，烟气没法降温到 targetFlueOut
        
        // 实际蒸发吸热量
        const qEvapActual = (recoveryType === RECOVERY_TYPES.MVR) 
            ? (recoveredHeat - driveEnergy) 
            : (recoveredHeat / copRatio); // 近似回推

        let actualFlueOut;
        if (qEvapActual >= sourcePotential.total - 0.1) {
            // 热源被榨干 (Source Limited)
            actualFlueOut = targetFlueOut;
        } else {
            // 热源有富余 (Sink Limited)
            const deltaT = qEvapActual / (flowVol * Cp_flue);
            actualFlueOut = targetFlueIn - deltaT;
            
            // 安全限制
            if (actualFlueOut > targetFlueIn) actualFlueOut = targetFlueIn;
        }

        return {
            cop: perfData.cop,
            lift: perfData.lift,
            recoveredHeat, 
            driveEnergy,   
            isSinkLimited: (recoveredHeat < qSourceLimit),
            actualLoadOut: parseFloat(actualLoadOut.toFixed(1)), // 返回反算后的水温
            actualFlueOut: parseFloat(actualFlueOut.toFixed(1))  // 返回反算后的烟温
        };
    }
}
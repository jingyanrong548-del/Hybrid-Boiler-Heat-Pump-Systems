// src/models/HeatPump.js
import { calculateCOP } from '../core/cycles.js';
import { STRATEGIES, MODES } from '../core/constants.js';
import { estimateEnthalpy } from '../core/physics.js';

export class HeatPump {
    constructor(config) {
        // config: { recoveryType, mode, strategy, perfectionDegree, totalLoadKW, ... }
        this.config = config;
    }

    simulate(sourcePotential, thermalDemand) {
        const { flueOut: targetFlueOut } = sourcePotential; 
        const { loadIn, loadOut, targetTemp } = thermalDemand;
        const { mode, strategy, recoveryType, perfectionDegree, totalLoadKW } = this.config;

        if (targetFlueOut === undefined || targetFlueOut === null) {
            return { error: "Internal Error: Heat source temp missing" };
        }

        // 1. 温度设定
        const tEvap = targetFlueOut - 5.0; 
        const tCond = targetTemp + 5.0; 

        // 2. 计算 COP
        const perfData = calculateCOP({
            evapTemp: tEvap,
            condTemp: tCond,
            efficiency: perfectionDegree,
            mode,
            strategy,
            recoveryType
        });

        if (perfData.error) return { error: perfData.error };

        // 3. [关键修复] 计算热汇限制 (Sink Limit)
        // 只有在 "蒸汽锅炉补水预热" 模式下，热泵才受限于补水量
        // 在其他模式（产热水、直接产汽），热泵理论上可以承担全部负荷
        let qSinkLimit = totalLoadKW; 

        if (mode === MODES.STEAM && strategy === STRATEGIES.PREHEAT) {
            // 预热模式：热泵能力受限于流经锅炉的补水量
            // 1. 计算锅炉产生 targetTemp 蒸汽所需的总焓升
            const h_steam = estimateEnthalpy(targetTemp, true);
            const h_feed_initial = estimateEnthalpy(loadIn, false);
            
            // 2. 反算总质量流量 (kg/s) = 总负荷 / (h_steam - h_feed_initial)
            // 注意：这里假设 loadKW 是锅炉的总输出能力
            const massFlow = totalLoadKW / (h_steam - h_feed_initial);
            
            // 3. 热泵能做的最大功 = 流量 * (h_preheat_target - h_feed_initial)
            const h_pre_target = estimateEnthalpy(loadOut, false);
            qSinkLimit = massFlow * (h_pre_target - h_feed_initial);
        } 
        // else: qSinkLimit 保持为 totalLoadKW (甚至可以是 Infinity，取决于是否允许超频)

        // 4. 实际回收量 (取 烟气潜力 与 热汇需求 的较小值)
        // 注意：sourcePotential.total 是烟气侧能提供的最大热量 (Q_source_max)
        // 热泵输出 Q_heat = Q_source + W_compressor
        // Q_heat = Q_source * [COP / (COP-1)]  (对于电动热泵)
        // 这是一个联立方程求解，为简化工程计算，通常取：
        
        // 烟气侧能提供的最大蒸发吸热量
        const maxEvapHeat = sourcePotential.total;
        
        // 基于烟气限制的最大输出热量
        const maxOutputFromSource = maxEvapHeat * (perfData.cop / (perfData.cop - 1));
        
        // 最终产热 = min(基于烟气的最大产热, 基于热汇的最大需热)
        const recoveredHeat = Math.min(maxOutputFromSource, qSinkLimit);
        
        // 5. 驱动能耗
        const driveEnergy = recoveredHeat / perfData.cop;

        // 6. 状态标记
        const isSinkLimited = (recoveredHeat >= qSinkLimit - 0.1); // 浮点容差
        const isSourceLimited = (recoveredHeat >= maxOutputFromSource - 0.1);

        // 7. 实际排烟温度反算 (仅供显示，暂不进行复杂迭代)
        let actualFlueOut = targetFlueOut;

        return {
            cop: perfData.cop,
            lift: perfData.lift,
            recoveredHeat, 
            driveEnergy,   
            isSinkLimited,
            actualFlueOut
        };
    }
}
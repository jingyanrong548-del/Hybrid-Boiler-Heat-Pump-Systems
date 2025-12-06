// logic.js - 核心计算逻辑

/**
 * 计算热泵性能 (简化版蒸气压缩循环)
 * @param {number} T_env_C  室外环境温度 (摄氏度)
 * @param {number} T_supply_C 目标供水温度 (摄氏度)
 * @param {object} Module CoolProp 的 WASM 实例
 */
export function calculateHeatPumpCycle(T_env_C, T_supply_C, Module) {
    try {
        const fluid = 'R134a'; // 假设制冷剂，以后可以改
        
        // 1. 设定循环参数
        // 蒸发温度 = 环境温度 - 换热温差(5度)
        const T_evap = (T_env_C - 5) + 273.15; 
        // 冷凝温度 = 供水温度 + 换热温差(5度)
        const T_cond = (T_supply_C + 5) + 273.15; 

        // 保护逻辑：如果蒸发温度太低，热泵可能停机
        if (T_evap < 243.15) { // 约 -30度
            return { cop: 1.0, capacity_ratio: 0, error: "温度过低，热泵停机" };
        }

        // 2. 调用 CoolProp 计算物性 (状态点计算)
        // 状态点1：吸气口 (假定饱和气体) -> 干度 Q=1, 温度 T=T_evap
        const h1 = Module.PropsSI('H', 'T', T_evap, 'Q', 1, fluid);
        const s1 = Module.PropsSI('S', 'T', T_evap, 'Q', 1, fluid);

        // 状态点2：排气口 (假定等熵压缩) -> 熵 S=s1, 温度 T=T_cond
        // 先算理想排气焓值 h2s
        const pressure_cond = Module.PropsSI('P', 'T', T_cond, 'Q', 1, fluid);
        const h2s = Module.PropsSI('H', 'P', pressure_cond, 'S', s1, fluid);
        
        // 考虑压缩机效率 (假设 0.7)
        const efficiency = 0.7;
        const h2 = h1 + (h2s - h1) / efficiency;

        // 状态点3：冷凝出口 (饱和液体) -> 温度 T=T_cond, 干度 Q=0
        const h3 = Module.PropsSI('H', 'T', T_cond, 'Q', 0, fluid);
        
        // 状态点4：膨胀阀出口 (等焓) -> h4 = h3

        // 3. 计算 COP (制热)
        // COP = 制热量 / 耗功量 = (h2 - h3) / (h2 - h1)
        const heating_effect = h2 - h3;
        const work_input = h2 - h1;
        let cop = heating_effect / work_input;

        return { 
            cop: parseFloat(cop.toFixed(2)),
            work_per_kg: work_input,
            error: null
        };

    } catch (e) {
        console.error("CoolProp 计算错误:", e);
        return { cop: 0, error: "物性计算失败" };
    }
}
/**
 * 计算混合系统策略
 * @param {number} loadKW 热负荷 (kW)
 * @param {number} cop 热泵COP
 * @param {number} elecPrice 电价 ($/kWh)
 * @param {number} gasPrice 气价 ($/m3)
 */
export function calculateHybridStrategy(loadKW, cop, elecPrice, gasPrice) {
    // 1. 计算热泵运行成本 ($/h)
    // 耗电量 = 负荷 / COP
    const hpPower = loadKW / cop; 
    const hpCost = hpPower * elecPrice;

    // 2. 计算锅炉运行成本 ($/h)
    // 假设天然气热值约为 10 kWh/m3，锅炉效率 90%
    const boilerEfficiency = 0.9;
    const gasCalorificValue = 10.0; // kWh/m3
    
    // 需要的天然气量 (m3/h) = 负荷 / (热值 * 效率)
    const gasVolume = loadKW / (gasCalorificValue * boilerEfficiency);
    const boilerCost = gasVolume * gasPrice;

    // 3. 决策逻辑 (谁便宜用谁)
    let strategy = "";
    let finalCost = 0;
    let hpRatio = 0;
    
    // 如果热泵 COP 太低(比如小于 2.0) 或者 热泵成本高于锅炉
    if (cop < 2.0 || hpCost > boilerCost) {
        strategy = "锅炉优先模式";
        finalCost = boilerCost;
        hpRatio = 0; // 热泵关，锅炉开
    } else {
        strategy = "热泵优先模式";
        finalCost = hpCost;
        hpRatio = 100; // 热泵开，锅炉关
    }

    return {
        mode: strategy,
        cost: finalCost,
        hpRatio: hpRatio,
        powerKW: (hpRatio === 100) ? hpPower : 0, // 简单展示：如果是热泵就显示电耗，锅炉则暂不显示电耗
        comparison: { hp: hpCost, boiler: boilerCost }
    };
}
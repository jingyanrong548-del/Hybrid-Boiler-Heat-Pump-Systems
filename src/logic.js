// src/logic.js - 核心计算逻辑 (v2.1 Industrial)

// --- 基础配置 ---
export const SYSTEM_CONFIG = {
    currency: 'CNY',
    // 工业余热源恒定温度 (例如：冷却水回水、冷凝器排热)
    wasteHeatTemp: 35.0, 
};

/**
 * 燃料数据库：统一化石能源的热值、成本与碳排放模型
 * 价格单位: CNY
 * 热值单位: kWh (归一化)
 * 碳排因子: kgCO2/kWh (热值当量)
 */
export const FuelDatabase = {
    // 天然气: 燃烧效率高，碳排中等
    'NATURAL_GAS': { 
        name: '天然气 (Natural Gas)', 
        calorificValue: 10.0, // kWh/m3
        efficiency: 0.92,     // 冷凝锅炉效率
        unit: 'm³',
        co2Factor: 0.202      // kgCO2/kWh (IPCC缺省值参考)
    },
    // 工业电力: 效率极高(直热)，但电网碳排较高
    'ELECTRICITY': { 
        name: '工业电力 (Electricity)', 
        calorificValue: 1.0, 
        efficiency: 0.98,     // 电阻锅炉效率
        unit: 'kWh',
        co2Factor: 0.58       // kgCO2/kWh (典型区域电网平均值)
    },
    // 煤炭: 价格低，效率低，碳排极高
    'COAL': { 
        name: '动力煤 (Coal)', 
        calorificValue: 7.0,  // kWh/kg (标煤折算)
        efficiency: 0.75,     // 燃煤锅炉效率
        unit: 'kg',
        co2Factor: 0.34       // kgCO2/kWh (折算热值后)
    }
};

/**
 * 核心物理计算：通用逆卡诺循环 (支持环境源与余热源)
 * @param {number} T_source_C  热源温度 (环境温度 或 余热温度)
 * @param {number} T_supply_C  目标供水温度
 * @param {object} Module      CoolProp 实例
 */
export function calculateHeatPumpCycle(T_source_C, T_supply_C, Module) {
    try {
        const fluid = 'R134a'; 
        
        // 1. 换热温差假设
        const dT_exchange = 5.0; 

        // 2. 确定循环边界
        // 蒸发温度 = 热源温度 - 换热温差
        const T_evap = (T_source_C - dT_exchange) + 273.15; 
        // 冷凝温度 = 供水温度 + 换热温差
        const T_cond = (T_supply_C + dT_exchange) + 273.15; 

        // 物理限制保护 (防止蒸发温度过低导致计算崩溃)
        if (T_evap < 233.15) { // < -40°C
            return { cop: 1.0, error: "温度过低，超出物理极限" };
        }

        // 3. 状态点计算 (State Points)
        // Point 1: 压缩机吸气 (饱和气)
        const h1 = Module.PropsSI('H', 'T', T_evap, 'Q', 1, fluid);
        const s1 = Module.PropsSI('S', 'T', T_evap, 'Q', 1, fluid);

        // Point 2: 压缩机排气 (假设等熵效率 0.75 - 工业机组)
        const P_cond = Module.PropsSI('P', 'T', T_cond, 'Q', 1, fluid);
        const h2s = Module.PropsSI('H', 'P', P_cond, 'S', s1, fluid);
        const isentropic_eff = 0.75;
        const h2 = h1 + (h2s - h1) / isentropic_eff;

        // Point 3: 冷凝器出口 (饱和液)
        const h3 = Module.PropsSI('H', 'T', T_cond, 'Q', 0, fluid);

        // 4. 性能计算
        // 制热量 q_h = h2 - h3
        // 耗功量 w = h2 - h1
        const heating_capacity_per_kg = h2 - h3;
        const work_input_per_kg = h2 - h1;

        let cop = heating_capacity_per_kg / work_input_per_kg;

        // 修正：实际系统会有辅机损耗 (风机/水泵)，打个 0.9 折扣
        cop = cop * 0.9;

        return { 
            cop: parseFloat(cop.toFixed(2)),
            sourceTemp: T_source_C, 
            error: null
        };

    } catch (e) {
        console.error("Cycle Calculation Error:", e);
        return { cop: 0, error: "物性计算失败" };
    }
}

/**
 * 工业级混合策略计算器 (含经济性与碳排放)
 * @param {object} params 输入参数对象
 */
export function calculateHybridStrategy(params) {
    const {
        loadKW,         // 热负荷
        cop,            // 当前工况 COP
        elecPrice,      // 电价 (CNY/kWh)
        fuelPrice,      // 燃料价格 (CNY/unit)
        fuelTypeKey,    // 燃料类型键值
        topology        // 'PARALLEL' | 'COUPLED'
    } = params;

    const fuelInfo = FuelDatabase[fuelTypeKey] || FuelDatabase['NATURAL_GAS'];
    const elecInfo = FuelDatabase['ELECTRICITY'];

    // --- 1. 热泵运行指标 (电) ---
    const hpPowerInput = loadKW / cop;          // kW (耗电)
    const hpHourlyCost = hpPowerInput * elecPrice; // CNY/h
    const hpCo2 = hpPowerInput * elecInfo.co2Factor; // kgCO2/h

    // --- 2. 锅炉运行指标 (燃料) ---
    // 燃料输入热量(kWh) = 负荷 / 效率
    const boilerInputHeat = loadKW / fuelInfo.efficiency;
    // 物理消耗量 (m3 或 kg)
    const fuelConsump = boilerInputHeat / fuelInfo.calorificValue; 
    const boilerHourlyCost = fuelConsump * fuelPrice; // CNY/h
    const boilerCo2 = boilerInputHeat * fuelInfo.co2Factor; // kgCO2/h

    // --- 3. 策略决策逻辑 ---
    let result = {
        mode: "",
        cost: 0,
        hpRatio: 0, // 0 - 100
        co2: 0,
        details: ""
    };

    if (topology === 'COUPLED') {
        // [模式 B: 余热耦合]
        // 只要热泵运行成本低于锅炉，优先全开热泵 (Base Load)
        if (hpHourlyCost < boilerHourlyCost) {
            result.mode = "余热提质模式 (Heat Upgrade)";
            result.cost = hpHourlyCost;
            result.hpRatio = 100;
            result.co2 = hpCo2;
        } else {
            result.mode = "燃料直燃模式 (Direct Firing)";
            result.cost = boilerHourlyCost;
            result.hpRatio = 0;
            result.co2 = boilerCo2;
        }
    } else {
        // [模式 A: 传统解耦]
        // COP太低(<2.5) 或 成本倒挂时切换至锅炉
        if (cop < 2.5 || hpHourlyCost > boilerHourlyCost) {
            result.mode = "燃料优先模式 (Fuel Priority)";
            result.cost = boilerHourlyCost;
            result.hpRatio = 0;
            result.co2 = boilerCo2;
        } else {
            result.mode = "电驱优先模式 (Elec Priority)";
            result.cost = hpHourlyCost;
            result.hpRatio = 100;
            result.co2 = hpCo2;
        }
    }

    return {
        ...result,
        powerKW: (result.hpRatio === 100) ? hpPowerInput : 0,
        fuelConsump: (result.hpRatio === 0) ? fuelConsump : 0,
        fuelUnit: fuelInfo.unit,
        // 返回对比数据供前端显示节省量
        comparison: { 
            hpCost: hpHourlyCost, 
            boilerCost: boilerHourlyCost,
            hpCo2: hpCo2,
            boilerCo2: boilerCo2
        }
    };
}
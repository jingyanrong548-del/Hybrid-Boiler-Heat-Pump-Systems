// src/core/constants.js

// === 枚举常量 (Enums) ===
export const TOPOLOGY = {
    PARALLEL: 'PARALLEL', // 方案A
    COUPLED: 'COUPLED',   // 方案B
    RECOVERY: 'RECOVERY'  // 方案C
};

export const MODES = {
    WATER: 'WATER',
    STEAM: 'STEAM'
};

export const STRATEGIES = {
    PREHEAT: 'STRATEGY_PRE', // 补水预热
    GEN: 'STRATEGY_GEN'      // 直接产汽
};

export const RECOVERY_TYPES = {
    MVR: 'ELECTRIC_HP',
    ABS: 'ABSORPTION_HP'
};

// === 物理限制 (Physical Limits) ===
export const LIMITS = {
    MIN_FLUE_TEMP: 70.0,      // 物理截止：低于此温度认为无回收价值
    MAX_COND_TEMP: 185.0,     // 压缩机技术极限
    MIN_EVAP_TEMP: -45.0,     // 蒸发极限
    MIN_LIFT_DELTA: 5.0,      // 最小温差 (冷凝-蒸发)
    STEAM_THRESHOLD: 100.0    // 视为蒸汽的温度阈值
};

// === 单位换算 (Converters) ===
export const UNIT_CONVERTERS = {
    'kWh': 1.0,
    'MJ': 3.6,
    'kcal': 860.0,
    'kJ': 3600.0,
    'GJ': 0.0036,
    'TON_TO_KW': 700.0 // 1 蒸吨 ≈ 700 kW (行业经验值)
};

// === 燃料数据库 (Fuel Database) v9.1 ===
// [v9.1 Upgrade] 引入理论值以支持过量空气系数(Alpha)的动态修正
// 之前的 flueGasFactor 是基于 alpha ≈ 1.1~1.2 的经验值
// 现在拆解为: 实际烟气量 = 理论烟气量 + (alpha-1) * 理论需气量
export const FUEL_DB = {
    'NATURAL_GAS': { 
        name: '天然气', 
        calorificValue: 10.0, 
        efficiency: 0.92, 
        unit: 'm³', 
        co2Factor: 0.202,
        // v9.1 新参数 (单位: m3/kWh)
        theoreticalGasFactor: 0.92, // alpha=1时的理论烟气生成量
        theoreticalAirNeed: 0.90,   // 理论需气量
        dewPointRef: 57.0           // alpha=1时的基准露点 (°C)
    },
    'ELECTRICITY': { 
        name: '工业电力', 
        calorificValue: 1.0, 
        efficiency: 0.98, 
        unit: 'kWh', 
        co2Factor: 0.58,
        theoreticalGasFactor: 0,
        theoreticalAirNeed: 0,
        dewPointRef: 0
    },
    'COAL': { 
        name: '动力煤', 
        calorificValue: 7.0, 
        efficiency: 0.75, 
        unit: 'kg', 
        co2Factor: 0.34,
        theoreticalGasFactor: 1.05, // 煤的烟气量较大
        theoreticalAirNeed: 1.00,
        dewPointRef: 45.0           // SO2/SO3会改变酸露点，此处仅指水露点
    },
    'DIESEL': { 
        name: '0# 柴油', 
        calorificValue: 10.3, 
        efficiency: 0.88, 
        unit: 'L', 
        co2Factor: 0.27,
        theoreticalGasFactor: 1.00,
        theoreticalAirNeed: 0.96,
        dewPointRef: 47.0
    },
    'BIOMASS': { 
        name: '生物质颗粒', 
        calorificValue: 4.8, 
        efficiency: 0.85, 
        unit: 'kg', 
        co2Factor: 0.05,
        theoreticalGasFactor: 1.15, // 含水率高，烟气量大
        theoreticalAirNeed: 1.05,
        dewPointRef: 55.0
    },
    'STEAM_PIPE': { 
        name: '管道蒸汽', 
        calorificValue: 750.0, 
        efficiency: 0.98, 
        unit: 't', 
        co2Factor: 0.35,
        theoreticalGasFactor: 0,
        theoreticalAirNeed: 0,
        dewPointRef: 0
    }
};
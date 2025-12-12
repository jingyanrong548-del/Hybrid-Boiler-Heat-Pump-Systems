// src/core/constants.js

// === 系统拓扑定义 ===
export const TOPOLOGY = {
    PARALLEL: 'PARALLEL', // 方案 A: 空气源热泵 (并联辅助)
    COUPLED: 'COUPLED',   // 方案 B: 水源热泵 (余热耦合)
    RECOVERY: 'RECOVERY'  // 方案 C: 烟气余热回收 (串联深度回收)
};

// === 运行模式定义 ===
export const MODES = {
    WATER: 'WATER', // 产热水
    STEAM: 'STEAM'  // 产蒸汽
};

// === 蒸汽策略定义 ===
export const STRATEGIES = {
    PREHEAT: 'STRATEGY_PRE', // 仅预热补水
    GEN: 'STRATEGY_GEN'      // 直接生产蒸汽
};

// === 热泵技术类型 ===
export const RECOVERY_TYPES = {
    MVR: 'ELECTRIC_HP',   // 电动压缩式 (MVR/Heat Pump)
    ABS: 'ABSORPTION_HP'  // 吸收式 (Absorption)
};

// === 物理极值与限制 ===
export const LIMITS = {
    MIN_FLUE_TEMP: 5.0,    // 最低排烟温度 (防止酸露点腐蚀的硬底线，虽然计算上允许更低)
    MAX_COND_TEMP: 160.0,  // 当前民用/工业热泵的技术上限
    MIN_EVAP_TEMP: -30.0,  // 空气源极限
    MIN_LIFT_DELTA: 10.0   // 最小温升 (过小会导致压缩机控制不稳)
};

// === 单位转换系数 ===
export const UNIT_CONVERTERS = {
    TON_TO_KW: 700.0, // 1 蒸吨 ≈ 700 kW (工程估算值，基于 60万大卡)
    KWH_TO_MJ: 3.6    // 1 kWh = 3.6 MJ
};

// === 燃料数据库 (Single Source of Truth) ===
// [v9.1.1 FIX]: 修正电力基准参数，防止碳排放倒挂
export const FUEL_DB = {
    'NATURAL_GAS': {
        name: '天然气 (Natural Gas)',
        // 基准热值: 36 MJ/m3 (约 10 kWh/m3)
        calorificValue: 36.0, 
        // 基准碳排: 2.18 kg/m3 (约 0.202 kg/kWh)
        co2Factor: 2.18,      
        unit: 'm³',
        // 燃烧特性 (用于计算烟气量和露点)
        theoreticalAirNeed: 9.5,     // m3_air / m3_fuel
        theoreticalGasFactor: 10.5,  // m3_gas / m3_fuel
        dewPointRef: 58.0            // 绝热燃烧露点 (°C)
    },
    'COAL': {
        name: '动力煤 (Coal)',
        calorificValue: 29.3,   // MJ/kg (7000 kcal)
        co2Factor: 2.6,         // kg/kg
        unit: 'kg',
        theoreticalAirNeed: 8.5,
        theoreticalGasFactor: 9.0,
        dewPointRef: 45.0
    },
    'DIESEL': {
        name: '0# 柴油 (Diesel)',
        calorificValue: 42.0,   // MJ/kg
        co2Factor: 3.1,         // kg/kg
        unit: 'kg',
        theoreticalAirNeed: 11.0,
        theoreticalGasFactor: 12.0,
        dewPointRef: 48.0
    },
    'BIOMASS': {
        name: '生物质颗粒 (Biomass)',
        calorificValue: 17.5,   // MJ/kg
        co2Factor: 0.0,         // 碳中性 (Carbon Neutral)
        unit: 'kg',
        theoreticalAirNeed: 5.0,
        theoreticalGasFactor: 6.0,
        dewPointRef: 40.0
    },
    'ELECTRICITY': {
        name: '工业电直热 (Elec Heater)',
        // [关键修正]: 1 kWh = 3.6 MJ (物理常数)
        calorificValue: 3.6,    
        // [关键修正]: 电网平均碳排因子 (0.6101 kg/kWh - 区域电网典型值)
        // 必须显著高于天然气 (0.202)，否则无法体现热泵减排优势
        co2Factor: 0.6101,      
        unit: 'kWh',
        // 电加热被视为 99% - 100% 效率
        defaultEfficiency: 0.99,
        // 无燃烧产物
        theoreticalAirNeed: 0,
        theoreticalGasFactor: 0,
        dewPointRef: 0
    },
    'STEAM_PIPE': {
        name: '管道蒸汽 (Pipeline Steam)',
        calorificValue: 2700, // kJ/kg -> 需注意单位换算，暂时预留
        co2Factor: 0.3,       // 假设热电联产分配
        unit: 't',
        theoreticalAirNeed: 0,
        theoreticalGasFactor: 0,
        dewPointRef: 0
    }
};
// src/logic.js - v6.4 Dashboard Kernel

// --- 1. 基础配置与换算常量 ---
export const SYSTEM_CONFIG = {
    wasteHeatTemp: 35.0, // 默认工业余热温度
    annualHours: 6000,   // 年运行小时数 (工业典型值)
};

// 能量单位换算系数 (目标基准: 1 kWh)
export const UNIT_CONVERTERS = {
    'kWh': 1.0,
    'MJ': 3.6,        // 1 kWh = 3.6 MJ
    'kcal': 860.0,    // 1 kWh ≈ 860 kcal
    'kJ': 3600.0,     // 1 kWh = 3600 kJ
    'GJ': 0.0036      // 1 kWh = 3.6e-3 GJ (用于蒸汽 GJ/t)
};

/**
 * 燃料数据库 (Standard Database)
 * 热值基准: kWh/unit
 * 碳排基准: kg/kWh (热值当量)
 */
export const FuelDatabase = {
    'NATURAL_GAS': {
        name: '天然气',
        calorificValue: 10.0, // ~36 MJ/m³
        efficiency: 0.92,
        unit: 'm³',
        co2Factor: 0.202
    },
    'ELECTRICITY': {
        name: '工业电力',
        calorificValue: 1.0,
        efficiency: 0.98,
        unit: 'kWh',
        co2Factor: 0.58
    },
    'COAL': {
        name: '动力煤',
        calorificValue: 7.0,  // ~5500 kcal/kg
        efficiency: 0.75,
        unit: 'kg',
        co2Factor: 0.34
    },
    'DIESEL': {
        name: '0# 柴油',
        calorificValue: 10.3, // ~10300 kcal/kg
        efficiency: 0.88,
        unit: 'L',
        co2Factor: 0.27
    },
    'BIOMASS': {
        name: '生物质颗粒',
        calorificValue: 4.8,  // ~4200 kcal/kg
        efficiency: 0.85,
        unit: 'kg',
        co2Factor: 0.05
    },
    'STEAM_PIPE': {
        name: '管道蒸汽',
        calorificValue: 750.0,// ~0.75 MWh/t
        efficiency: 0.98,
        unit: 't',
        co2Factor: 0.35
    }
};

// --- 2. 辅助计算函数 ---

/**
 * 压力转饱和温度 (Water Antoine Eq)
 * 适用: 蒸汽工况
 */
export function getSatTempFromPressure(pressureMPa) {
    if (pressureMPa <= 0) return 100;
    const P_mmHg = pressureMPa * 7500.62;
    const A = 8.07131, B = 1730.63, C = 233.426;
    const val = B / (A - Math.log10(P_mmHg)) - C;
    return parseFloat(val.toFixed(1));
}

/**
 * [v6.4 New] 温度转饱和压力估算 (R134a 简易拟合)
 * 用于估算压缩比 (Pressure Ratio)
 * @param {number} tempC 温度
 * @returns {number} 压力 (MPa, a)
 */
function estimateSatPressureR134a(tempC) {
    // 简化的 Antoine-like 拟合: P = exp(A - B/(T+C))
    // 工业常用范围 -20 ~ 80度
    const T_k = tempC + 273.15;
    // 粗略拟合 R134a
    // -20C -> 0.13 MPa
    // 0C -> 0.29 MPa
    // 50C -> 1.32 MPa
    // 80C -> 2.6 MPa
    // 使用简单的物理指数增长模型模拟展示
    return 0.2928 * Math.exp(0.035 * tempC);
}

/**
 * 单位归一化 (Normalize Inputs)
 */
function normalizeCalorific(val, unit) {
    // 例子: 用户输入 8600 kcal/m³
    // unit = 'kcal'
    // factor = 860
    // result = 8600 / 860 = 10 kWh/m³
    const factor = UNIT_CONVERTERS[unit] || 1.0;
    return val / factor;
}

function normalizeCo2Factor(val, unit) {
    // 单位格式如: kg/MJ
    // 提取分母: MJ
    const baseUnit = unit.split('/')[1] || 'kWh';
    const factor = UNIT_CONVERTERS[baseUnit] || 1.0;
    // 逻辑: 0.056 kg/MJ -> 1 kWh(3.6MJ) -> 0.056 * 3.6 = 0.2016 kg/kWh
    return val * factor;
}

// --- 3. 核心物理循环计算 (Process Cycle) ---
export function calculateProcessCycle(params) {
    const { mode, sourceTemp, targetVal, perfectionDegree } = params;

    try {
        let T_evap_C = sourceTemp - 5.0; // 蒸发温度
        let T_cond_C = 0;
        let isSteam = (mode === 'STEAM');

        // 1. 确定冷凝侧状态
        if (isSteam) {
            T_cond_C = getSatTempFromPressure(targetVal) + 8.0;
        } else {
            T_cond_C = targetVal + 5.0;
        }

        // 2. 物理极值保护
        if (T_evap_C < -45) return { cop: 1.0, error: "T_evap Too Low" };
        if (T_cond_C > 185) return { cop: 1.0, error: "T_cond Too High" };
        if (T_cond_C <= T_evap_C + 5) return { cop: 5.0, error: "Low Lift" };

        // 3. 基础热力计算
        const T_evap_K = T_evap_C + 273.15;
        const T_cond_K = T_cond_C + 273.15;

        // 卡诺效率
        const cop_carnot = T_cond_K / (T_cond_K - T_evap_K);
        // 实际 COP
        let eta = perfectionDegree || (isSteam ? 0.45 : 0.50);
        let real_cop = cop_carnot * eta * 0.92; // 0.92 辅机修正

        // [v6.4 New] 工程参数计算
        const lift = T_cond_C - T_evap_C; // 温升
        // 估算压缩比 (P_cond / P_evap)
        // 如果是蒸汽压缩机(Steam Mode)，介质是水
        // 如果是热水机组(Water Mode)，介质通常是冷媒
        let p_ratio = 0;
        if (isSteam) {
            // 水蒸气压缩比估算
            // P_evap 对应 T_evap_C (饱和)
            // P_cond 对应 T_cond_C (饱和) -- 注意这里用冷凝温度估算排气压力
            const p_evap = getSatTempFromPressure(0.1) === 100 ? 0.1 : 0.01; // 简化占位，实际需反函数
            // 由于没有写水的 P(T) 函数，这里用简化逻辑：
            // 对于蒸汽MVR，温升 10度 ~ 压缩比 1.4-1.6
            // 简单经验公式：P_ratio ≈ (T_cond_K / T_evap_K)^ (Gamma/(Gamma-1)) ?
            // 采用近似值: 1 + (Lift / 30)
            p_ratio = 1.0 + (lift / 25.0);
        } else {
            // 冷媒压缩比估算
            const p_evap = estimateSatPressureR134a(T_evap_C);
            const p_cond = estimateSatPressureR134a(T_cond_C);
            p_ratio = p_cond / p_evap;
        }

        return {
            cop: parseFloat(real_cop.toFixed(2)),
            lift: parseFloat(lift.toFixed(1)),
            pRatio: parseFloat(p_ratio.toFixed(1)),
            satTemp: isSteam ? (T_cond_C - 8.0) : null,
            error: null
        };

    } catch (e) {
        console.error("Calc Error:", e);
        return { cop: 0, error: "Internal Error" };
    }
}

// --- 4. 混合策略与经济性计算 (Dashboard Edition) ---
export function calculateHybridStrategy(params) {
    const {
        loadKW,
        cop, manualCop,
        elecPrice, fuelPrice, fuelTypeKey, topology,

        // Custom Inputs
        customCalorific, calUnit,
        customCo2, co2Unit,
        customEfficiency,

        annualHours // [新增] 接收年运行小时数
    } = params;

    // 1. 标准化参数
    const dbFuel = FuelDatabase[fuelTypeKey] || FuelDatabase['NATURAL_GAS'];
    const dbElec = FuelDatabase['ELECTRICITY'];

    const activeEff = (customEfficiency && customEfficiency > 0) ? customEfficiency : dbFuel.efficiency;

    // 热值标准化 (kWh/Unit)
    let activeCalVal = dbFuel.calorificValue;
    if (customCalorific && customCalorific > 0) {
        activeCalVal = normalizeCalorific(customCalorific, calUnit);
    }

    // 碳因子标准化 (kg/kWh)
    let activeCo2Factor = dbFuel.co2Factor;
    if (customCo2 !== undefined && customCo2 >= 0) {
        activeCo2Factor = normalizeCo2Factor(customCo2, co2Unit);
    }

    // 确定 COP
    const activeCop = (manualCop && manualCop > 0) ? manualCop : cop;

    // 2. 成本流计算 (Hourly)

    // Path A: Heat Pump
    const hpPower = loadKW / activeCop;
    const costHP = hpPower * elecPrice; // ¥/h
    const co2HP = hpPower * dbElec.co2Factor; // kg/h

    // Path B: Boiler
    const boilerInputHeat_kWh = loadKW / activeEff;
    const fuelConsump = boilerInputHeat_kWh / activeCalVal; // Unit/h
    const costBoiler = fuelConsump * fuelPrice; // ¥/h
    const co2Boiler = boilerInputHeat_kWh * activeCo2Factor; // kg/h

    // 3. 策略判定
    let useHP = false;
    let modeName = "";

    if (topology === 'COUPLED') {
        useHP = (costHP < costBoiler);
        modeName = useHP ? "余热回收 (Heat Recovery)" : "传统直燃 (Direct Firing)";
    } else {
        const techThreshold = (manualCop > 0) ? 0 : 2.5;
        useHP = (activeCop > techThreshold && costHP < costBoiler);
        modeName = useHP ? "电驱优先 (Electric)" : "燃料优先 (Fuel)";
    }

    const activeCost = useHP ? costHP : costBoiler;
    const activeCo2 = useHP ? co2HP : co2Boiler;

    // 4. [v6.4 New] 深度经济指标
    // 综合单价 (¥/kWh_heat) = 小时总成本 / 供热负荷
    const unitCost = activeCost / loadKW;

    // [修改] 年化节省 (vs Boiler) - 使用传入的 annualHours
    const hourlySaving = costBoiler - costHP;
    // 使用 params.annualHours 替代 SYSTEM_CONFIG.annualHours
    const annualSaving = hourlySaving > 0 ? (hourlySaving * annualHours) : 0;
    // 碳减排率
    let co2ReductionRate = 0;
    if (co2Boiler > 0) {
        co2ReductionRate = (co2Boiler - activeCo2) / co2Boiler * 100;
        if (co2ReductionRate < 0) co2ReductionRate = 0; // 没减排就不显示负数
    }

    return {
        mode: modeName,
        activeCop: activeCop,
        hpRatio: useHP ? 100 : 0,
        powerKW: useHP ? hpPower : 0,
        cost: activeCost,
        co2: activeCo2,

        // Dashboard Metrics
        unitCost: unitCost,          // 综合热价
        annualSaving: annualSaving,  // 年节省
        co2Reduction: co2ReductionRate, // 减排率

        comparison: {
            hpCost: costHP,
            boilerCost: costBoiler,
            hpCo2: co2HP,
            boilerCo2: co2Boiler
        }
    };
}
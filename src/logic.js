// src/logic.js - v6.5 ROI Kernel

// --- 1. 基础配置与换算常量 ---
export const SYSTEM_CONFIG = {
    wasteHeatTemp: 35.0, // 默认工业余热温度
    // [New] 估算投资成本参数 (CNY/kW_thermal)
    capex_HP: 2000.0,    // 工业热泵系统估算造价
    capex_Boiler: 200.0  // 燃气/电锅炉系统估算造价
};

// 能量单位换算系数 (目标基准: 1 kWh)
export const UNIT_CONVERTERS = {
    'kWh': 1.0,
    'MJ': 3.6,        
    'kcal': 860.0,    
    'kJ': 3600.0,     
    'GJ': 0.0036      
};

/**
 * 燃料数据库
 */
export const FuelDatabase = {
    'NATURAL_GAS': { 
        name: '天然气', 
        calorificValue: 10.0, 
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
        calorificValue: 7.0,  
        efficiency: 0.75,     
        unit: 'kg',
        co2Factor: 0.34 
    },
    'DIESEL': { 
        name: '0# 柴油', 
        calorificValue: 10.3, 
        efficiency: 0.88,     
        unit: 'L',
        co2Factor: 0.27 
    },
    'BIOMASS': { 
        name: '生物质颗粒', 
        calorificValue: 4.8,  
        efficiency: 0.85,     
        unit: 'kg',
        co2Factor: 0.05       
    },
    'STEAM_PIPE': { 
        name: '管道蒸汽', 
        calorificValue: 750.0,
        efficiency: 0.98,     
        unit: 't',
        co2Factor: 0.35       
    }
};

// --- 2. 辅助计算函数 ---

export function getSatTempFromPressure(pressureMPa) {
    if (pressureMPa <= 0) return 100;
    const P_mmHg = pressureMPa * 7500.62;
    const A = 8.07131, B = 1730.63, C = 233.426;
    const val = B / (A - Math.log10(P_mmHg)) - C;
    return parseFloat(val.toFixed(1));
}

function estimateSatPressureR134a(tempC) {
    return 0.2928 * Math.exp(0.035 * tempC); 
}

function normalizeCalorific(val, unit) {
    const factor = UNIT_CONVERTERS[unit] || 1.0;
    return val / factor; 
}

function normalizeCo2Factor(val, unit) {
    const baseUnit = unit.split('/')[1] || 'kWh';
    const factor = UNIT_CONVERTERS[baseUnit] || 1.0;
    return val * factor;
}

// --- 3. 核心物理循环计算 ---
export function calculateProcessCycle(params) {
    const { mode, sourceTemp, targetVal, perfectionDegree } = params;

    try {
        let T_evap_C = sourceTemp - 5.0; 
        let T_cond_C = 0;
        let isSteam = (mode === 'STEAM');
        
        if (isSteam) {
            T_cond_C = getSatTempFromPressure(targetVal) + 8.0; 
        } else {
            T_cond_C = targetVal + 5.0; 
        }

        // [Update] 扩展温度验证范围 -45 ~ 185
        if (T_evap_C < -45) return { cop: 1.0, error: "蒸发温度过低" };
        if (T_cond_C > 185) return { cop: 1.0, error: "冷凝温度过高" };
        if (T_cond_C <= T_evap_C + 5) return { cop: 5.0, error: "温升不足" };

        const T_evap_K = T_evap_C + 273.15;
        const T_cond_K = T_cond_C + 273.15;
        
        const cop_carnot = T_cond_K / (T_cond_K - T_evap_K);
        let eta = perfectionDegree || (isSteam ? 0.45 : 0.50);
        let real_cop = cop_carnot * eta * 0.92; 

        const lift = T_cond_C - T_evap_C; 
        let p_ratio = 0;
        if (isSteam) {
            p_ratio = 1.0 + (lift / 25.0); 
        } else {
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

// --- 4. 混合策略与经济性计算 (ROI Edition) ---
export function calculateHybridStrategy(params) {
    const { 
        loadKW, 
        cop, manualCop,          
        elecPrice, fuelPrice, fuelTypeKey, topology,
        customCalorific, calUnit,
        customCo2, co2Unit,
        customEfficiency,
        annualHours 
    } = params;
    
    // 1. 标准化
    const dbFuel = FuelDatabase[fuelTypeKey] || FuelDatabase['NATURAL_GAS'];
    const dbElec = FuelDatabase['ELECTRICITY'];
    
    const activeEff = (customEfficiency && customEfficiency > 0) ? customEfficiency : dbFuel.efficiency;
    
    let activeCalVal = dbFuel.calorificValue;
    if (customCalorific && customCalorific > 0) {
        activeCalVal = normalizeCalorific(customCalorific, calUnit);
    }
    
    let activeCo2Factor = dbFuel.co2Factor;
    if (customCo2 !== undefined && customCo2 >= 0) {
        activeCo2Factor = normalizeCo2Factor(customCo2, co2Unit);
    }
    
    const activeCop = (manualCop && manualCop > 0) ? manualCop : cop;

    // 2. 成本流
    // A: Heat Pump
    const hpPower = loadKW / activeCop;
    const costHP = hpPower * elecPrice; 
    const co2HP = hpPower * dbElec.co2Factor; 

    // B: Boiler
    const boilerInputHeat_kWh = loadKW / activeEff;
    const fuelConsump = boilerInputHeat_kWh / activeCalVal; 
    const costBoiler = fuelConsump * fuelPrice; 
    const co2Boiler = boilerInputHeat_kWh * activeCo2Factor; 

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

    // 4. 深度指标 (ROI Calculation)
    const unitCost = activeCost / loadKW;
    
    // 年节省额
    const hourlySaving = costBoiler - costHP;
    const annualSaving = hourlySaving > 0 ? (hourlySaving * annualHours) : 0;
    
    // [New] 静态回收期 = (热泵造价 - 锅炉造价) / 年节省额
    let paybackYears = 0;
    if (useHP && annualSaving > 0) {
        // 估算 CAPEX
        const investHP = loadKW * SYSTEM_CONFIG.capex_HP;
        const investBoiler = loadKW * SYSTEM_CONFIG.capex_Boiler;
        const incrementalInvest = investHP - investBoiler;
        
        paybackYears = incrementalInvest / annualSaving;
        // 如果回收期 > 20年，视为无意义
        if (paybackYears > 20) paybackYears = 99;
    } else {
        paybackYears = 0; // 无优势或使用锅炉模式
    }
    
    // 减排率
    let co2ReductionRate = 0;
    if (co2Boiler > 0) {
        co2ReductionRate = (co2Boiler - activeCo2) / co2Boiler * 100;
        if (co2ReductionRate < 0) co2ReductionRate = 0;
    }

    return {
        mode: modeName,
        activeCop: activeCop,
        hpRatio: useHP ? 100 : 0,
        powerKW: useHP ? hpPower : 0,
        cost: activeCost,
        co2: activeCo2,
        
        // Metrics
        unitCost: unitCost,
        annualSaving: annualSaving,
        co2Reduction: co2ReductionRate,
        paybackPeriod: parseFloat(paybackYears.toFixed(1)), // [New]
        
        comparison: {
            hpCost: costHP, 
            boilerCost: costBoiler,
            hpCo2: co2HP, 
            boilerCo2: co2Boiler
        }
    };
}
// src/logic.js - v7.4 Stable Kernel

export const SYSTEM_CONFIG = {
    wasteHeatTemp: 35.0, 
    capex_HP: 2000.0,    
    capex_Boiler: 200.0  
};

export const UNIT_CONVERTERS = {
    'kWh': 1.0, 'MJ': 3.6, 'kcal': 860.0, 'kJ': 3600.0, 'GJ': 0.0036
};

export const FuelDatabase = {
    'NATURAL_GAS': { 
        name: '天然气', calorificValue: 10.0, efficiency: 0.92, unit: 'm³', co2Factor: 0.202,
        flueGasFactor: 1.1, dewPoint: 57.0 
    },
    'ELECTRICITY': { 
        name: '工业电力', calorificValue: 1.0, efficiency: 0.98, unit: 'kWh', co2Factor: 0.58,
        flueGasFactor: 0, dewPoint: 0
    },
    'COAL': { 
        name: '动力煤', calorificValue: 7.0, efficiency: 0.75, unit: 'kg', co2Factor: 0.34,
        flueGasFactor: 1.2, dewPoint: 45.0
    },
    'DIESEL': { 
        name: '0# 柴油', calorificValue: 10.3, efficiency: 0.88, unit: 'L', co2Factor: 0.27,
        flueGasFactor: 1.15, dewPoint: 47.0
    },
    'BIOMASS': { 
        name: '生物质颗粒', calorificValue: 4.8, efficiency: 0.85, unit: 'kg', co2Factor: 0.05,
        flueGasFactor: 1.3, dewPoint: 55.0
    },
    'STEAM_PIPE': { 
        name: '管道蒸汽', calorificValue: 750.0, efficiency: 0.98, unit: 't', co2Factor: 0.35,
        flueGasFactor: 0, dewPoint: 0
    }
};

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

// 标准循环
export function calculateProcessCycle(params) {
    const { mode, sourceTemp, targetVal, perfectionDegree } = params;
    try {
        let T_evap_C = sourceTemp - 5.0; 
        let T_cond_C = mode === 'STEAM' ? (getSatTempFromPressure(targetVal) + 8.0) : (targetVal + 5.0);

        if (T_evap_C < -45) return { cop: 1.0, error: "蒸发温度过低" };
        if (T_cond_C > 185) return { cop: 1.0, error: "冷凝温度过高" };
        if (T_cond_C <= T_evap_C + 5) return { cop: 5.0, error: "温升不足" };

        const T_evap_K = T_evap_C + 273.15;
        const T_cond_K = T_cond_C + 273.15;
        const cop_carnot = T_cond_K / (T_cond_K - T_evap_K);
        
        let eta = perfectionDegree || (mode === 'STEAM' ? 0.45 : 0.50);
        let real_cop = cop_carnot * eta * 0.92; 

        const lift = T_cond_C - T_evap_C; 
        let p_ratio = mode === 'STEAM' ? (1.0 + (lift / 25.0)) : (estimateSatPressureR134a(T_cond_C) / estimateSatPressureR134a(T_evap_C));

        return {
            cop: parseFloat(real_cop.toFixed(2)),
            lift: parseFloat(lift.toFixed(1)),
            pRatio: parseFloat(p_ratio.toFixed(1)),
            satTemp: mode === 'STEAM' ? (T_cond_C - 8.0) : null,
            error: null
        };
    } catch (e) {
        return { cop: 0, error: "Internal Error" };
    }
}

// 烟气回收算法 (Fixed)
export function calculateFlueGasRecovery(params) {
    const { 
        loadKW, boilerEff, fuelType, 
        tExhaustIn, tExhaustOut, 
        recoveryType, targetWaterTemp
    } = params;

    const dbFuel = FuelDatabase[fuelType] || FuelDatabase['NATURAL_GAS'];
    const boilerInputKW = loadKW / boilerEff; 
    const flueGasVol = boilerInputKW * dbFuel.flueGasFactor; 
    
    // 显热 (Corrected Unit)
    const Cp_flue_kWh = 0.00038; 
    const sensibleHeatKW = flueGasVol * Cp_flue_kWh * (tExhaustIn - tExhaustOut);

    // 潜热
    let latentHeatKW = 0;
    let waterRecovery_kg_h = 0;
    
    if (tExhaustOut < dbFuel.dewPoint) {
        const maxLatentRatio = (fuelType === 'NATURAL_GAS') ? 0.11 : ((fuelType === 'BIOMASS') ? 0.08 : 0.0);
        const maxLatentKW = boilerInputKW * maxLatentRatio;
        
        let condFactor = (dbFuel.dewPoint - tExhaustOut) / (dbFuel.dewPoint - 30);
        if (condFactor > 1) condFactor = 1;
        if (condFactor < 0) condFactor = 0;
        
        latentHeatKW = maxLatentKW * condFactor;
        waterRecovery_kg_h = (latentHeatKW * 3600) / 2260; 
    }

    const sourceHeatKW = sensibleHeatKW + latentHeatKW;

    // 热泵
    let cop = 0;
    let driveEnergyKW = 0; 
    let outputHeatKW = 0;  

    if (recoveryType === 'ELECTRIC_HP') {
        const tEvap = (tExhaustIn + tExhaustOut) / 2 - 10; 
        const tCond = targetWaterTemp + 5;
        const tk_evap = tEvap + 273.15;
        const tk_cond = tCond + 273.15;
        let cop_carnot = tk_cond / (tk_cond - tk_evap);
        if (cop_carnot > 15) cop_carnot = 15; 
        cop = cop_carnot * 0.45; 
        if (cop < 2) cop = 2; if (cop > 6) cop = 6;
        
        driveEnergyKW = sourceHeatKW / (cop - 1);
        outputHeatKW = sourceHeatKW + driveEnergyKW;
    } else {
        cop = 1.7; 
        driveEnergyKW = sourceHeatKW / (cop - 1); 
        outputHeatKW = sourceHeatKW + driveEnergyKW;
    }

    return {
        recoveredHeat: outputHeatKW, 
        driveEnergy: driveEnergyKW,  
        cop: parseFloat(cop.toFixed(2)),
        waterRecovery: parseFloat((waterRecovery_kg_h / 1000).toFixed(2)), // to Ton
        exhaustOutActual: tExhaustOut
    };
}

// 混合策略 (Variable Typo Fixed)
export function calculateHybridStrategy(params) {
    const { 
        loadKW, topology, annualHours,
        elecPrice, fuelPrice, fuelTypeKey,
        customCalorific, calUnit, customCo2, co2Unit, customEfficiency,
        tExhaustIn, tExhaustOut, recoveryType, targetWaterTemp,
        capexHP, capexBase, pefElec, cop, manualCop
    } = params;
    
    const dbFuel = FuelDatabase[fuelTypeKey] || FuelDatabase['NATURAL_GAS'];
    const activeEff = (customEfficiency && customEfficiency > 0) ? customEfficiency : dbFuel.efficiency;
    
    let activeCalVal = dbFuel.calorificValue;
    if (customCalorific && customCalorific > 0) activeCalVal = normalizeCalorific(customCalorific, calUnit);
    
    let activeCo2Factor = dbFuel.co2Factor;
    if (customCo2 !== undefined && customCo2 >= 0) activeCo2Factor = normalizeCo2Factor(customCo2, co2Unit);

    const boilerInput_kWh = loadKW / activeEff;
    const baselineCost = (boilerInput_kWh / activeCalVal) * fuelPrice;
    const baselineCo2 = boilerInput_kWh * activeCo2Factor;
    const baselinePrimary = boilerInput_kWh * 1.05; 

    if (topology === 'RECOVERY') {
        const recRes = calculateFlueGasRecovery({
            loadKW, boilerEff: activeEff, fuelType: fuelTypeKey,
            tExhaustIn, tExhaustOut, recoveryType, targetWaterTemp,
            fuelCalVal: activeCalVal
        });

        const savedFuelCost = (recRes.recoveredHeat / activeEff / activeCalVal) * fuelPrice;
        
        let driveCost = 0;
        let driveCo2 = 0;
        let drivePrimary = 0;

        if (recoveryType === 'ELECTRIC_HP') {
            driveCost = recRes.driveEnergy * elecPrice;
            driveCo2 = recRes.driveEnergy * FuelDatabase['ELECTRICITY'].co2Factor;
            drivePrimary = recRes.driveEnergy * pefElec;
        } else {
            const driveInput = recRes.driveEnergy / activeEff;
            driveCost = (driveInput / activeCalVal) * fuelPrice;
            driveCo2 = driveInput * activeCo2Factor;
            drivePrimary = driveInput * 1.05;
        }

        const hourlySaving = savedFuelCost - driveCost;
        const newCost = baselineCost - hourlySaving;
        const annualSaving = hourlySaving * annualHours;
        
        const investHP = recRes.recoveredHeat * capexHP; 
        const payback = (annualSaving > 0) ? (investHP / annualSaving) : 99;

        // [FIXED Variable Name]
        const netPrimaryInput = baselinePrimary - (recRes.recoveredHeat/activeEff * 1.05) + drivePrimary;
        const per = netPrimaryInput > 0 ? (loadKW / netPrimaryInput) : 0; 

        return {
            mode: `余热回收 (${recoveryType === 'ELECTRIC_HP' ? 'MVR' : 'ABS'})`,
            activeCop: recRes.cop,
            hpRatio: (recRes.recoveredHeat / loadKW * 100).toFixed(1),
            powerKW: recRes.driveEnergy,
            cost: newCost,
            co2: baselineCo2 - (savedFuelCost/fuelPrice/activeCalVal * activeCo2Factor) + driveCo2,
            
            unitCost: newCost / loadKW,
            annualSaving: annualSaving,
            co2Reduction: (hourlySaving / baselineCost * 100),
            paybackPeriod: parseFloat(payback.toFixed(1)),
            waterRecovery: recRes.waterRecovery,
            per: parseFloat(per.toFixed(2)),
            
            comparison: { hpCost: 0, boilerCost: baselineCost, hpCo2: 0, boilerCo2: baselineCo2 }
        };

    } else {
        const activeCop = (manualCop > 0) ? manualCop : cop;
        const hpPower = loadKW / activeCop;
        const costHP = hpPower * elecPrice;
        const co2HP = hpPower * FuelDatabase['ELECTRICITY'].co2Factor;
        const hpPrimary = hpPower * pefElec;

        let useHP = false;
        if (topology === 'COUPLED') useHP = (costHP < baselineCost);
        else useHP = (activeCop > 2.5 && costHP < baselineCost);
        
        const activeCost = useHP ? costHP : baselineCost;
        const activeCo2 = useHP ? co2HP : baselineCo2;
        const activePrimary = useHP ? hpPrimary : baselinePrimary;

        const hourlySaving = baselineCost - costHP;
        const annualSaving = hourlySaving > 0 ? hourlySaving * annualHours : 0;
        
        let payback = 0;
        if (useHP && annualSaving > 0) {
            const investDiff = loadKW * (capexHP - capexBase);
            payback = investDiff / annualSaving;
        }

        return {
            mode: useHP ? "热泵优先" : "锅炉优先",
            activeCop: activeCop,
            hpRatio: useHP ? 100 : 0,
            powerKW: useHP ? hpPower : 0,
            cost: activeCost,
            co2: activeCo2,
            
            unitCost: activeCost / loadKW,
            annualSaving: annualSaving,
            co2Reduction: useHP ? (baselineCo2 - co2HP)/baselineCo2*100 : 0,
            paybackPeriod: parseFloat(payback.toFixed(1)),
            per: parseFloat((loadKW / activePrimary).toFixed(2)),
            
            comparison: { hpCost: costHP, boilerCost: baselineCost, hpCo2: co2HP, boilerCo2: baselineCo2 }
        };
    }
}
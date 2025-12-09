// src/logic.js - v7.9 Steam Enhanced (Sink Limit & Preheating)

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

// 简易饱和温度计算
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

// 🟢 新增：焓值估算 (kJ/kg) 用于热平衡计算
function estimateEnthalpy(tempC, isSteam = false) {
    if (!isSteam) {
        // 水的比热容 ~ 4.187 kJ/kg.K
        return 4.187 * tempC;
    } else {
        // 饱和蒸汽焓值估算 (简化版: 0.1MPa~1.0MPa 范围)
        // h_g ≈ 2676 + 0.4*(T-100) (非常粗略的线性拟合，但在工程估算误差范围内)
        return 2676 + 0.5 * (tempC - 100);
    }
}

// 标准循环 (方案A/B)
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

// 🟢 v7.9 重构：calculateFlueGasRecovery (含策略分流)
export function calculateFlueGasRecovery(params) {
    const { 
        loadKW, boilerEff, fuelType, 
        tExhaustIn, tExhaustOut, 
        recoveryType, targetWaterTemp,
        perfectionDegree,
        steamStrategy, // 'STRATEGY_GEN' | 'STRATEGY_PRE'
        tFeed, tPre   // 补水温度, 预热目标温度
    } = params;
    
    const eta = perfectionDegree || 0.45;

    // 1. 计算烟气侧潜在能力 (Source Potential)
    const dbFuel = FuelDatabase[fuelType] || FuelDatabase['NATURAL_GAS'];
    const boilerInputKW = loadKW / boilerEff; 
    const flueGasVol = boilerInputKW * dbFuel.flueGasFactor; 
    const Cp_flue_kWh = 0.00038; 
    
    // 显热 (假设能降到 tExhaustOut)
    const sensiblePotential = flueGasVol * Cp_flue_kWh * (tExhaustIn - tExhaustOut);
    
    // 潜热 (如果低于露点)
    let latentPotential = 0;
    if (tExhaustOut < dbFuel.dewPoint) {
        const maxLatentRatio = (fuelType === 'NATURAL_GAS') ? 0.11 : ((fuelType === 'BIOMASS') ? 0.08 : 0.0);
        const maxLatentKW = boilerInputKW * maxLatentRatio;
        
        let condFactor = (dbFuel.dewPoint - tExhaustOut) / (dbFuel.dewPoint - 30);
        if (condFactor > 1) condFactor = 1;
        if (condFactor < 0) condFactor = 0;
        
        latentPotential = maxLatentKW * condFactor;
    }
    const qSourcePotential = sensiblePotential + latentPotential;

    // 2. 计算热汇限制 (Sink Limit)
    let qSinkLimit = Infinity; // 默认无限
    let effectiveTargetT = targetWaterTemp; // 计算 COP 用的目标温度

    if (steamStrategy === 'STRATEGY_PRE') {
        // --- 策略 B: 补水预热 ---
        // 逻辑：锅炉产生Load所需的蒸汽，需要一定的补水流量。热泵最多只能把这股水流从 tFeed 加热到 tPre
        
        const h_steam = estimateEnthalpy(targetWaterTemp, true); // 蒸汽焓
        const h_feed = estimateEnthalpy(tFeed, false);           // 补水焓
        
        // 锅炉系统水流量 (kg/s) = 负荷 / (蒸汽焓 - 补水焓)
        const massFlow = loadKW / (h_steam - h_feed); 
        
        const h_pre = estimateEnthalpy(tPre, false);             // 预热后水焓
        
        // 热汇极限 = 流量 * (预热焓 - 补水焓)
        qSinkLimit = massFlow * (h_pre - h_feed);
        
        effectiveTargetT = tPre; // COP 计算目标改为预热温度 (如 90度)
    
    } else if (steamStrategy === 'STRATEGY_GEN') {
        // --- 策略 A: 直接产汽 ---
        // 逻辑：热泵直接产汽，SinkLimit 就是总负荷
        qSinkLimit = loadKW;
        effectiveTargetT = targetWaterTemp; // COP 计算目标保持为蒸汽饱和温度
    }

    // 3. 确定实际回收量 (Physics Balance)
    // 实际回收 = min(烟气能提供的, 水能带走的)
    const recoveredHeatActual = Math.min(qSourcePotential, qSinkLimit);

    // 4. 反算实际排烟温度 (Back Calculation)
    let exhaustOutActual = tExhaustOut;
    
    if (qSourcePotential > qSinkLimit) {
        // 烟气能量过剩，说明水太少带不走。排烟温度会被迫升高。
        // 简单估算：温升与回收量成反比 (忽略潜热非线性，做线性近似回推)
        // 实际上主要是显热段没吃完
        const unrecovered = qSourcePotential - recoveredHeatActual;
        // 估算温升 deltaT = Q / (Vol * Cp)
        const tempRise = unrecovered / (flueGasVol * Cp_flue_kWh);
        exhaustOutActual = tExhaustOut + tempRise;
        
        // 修正：如果反算温度高于入口，则完全不回收 (极端情况)
        if (exhaustOutActual > tExhaustIn) exhaustOutActual = tExhaustIn;
    }

    // 5. 计算 COP (基于实际工况)
    let cop = 0;
    
    if (recoveryType === 'ELECTRIC_HP') {
        // MVR / 电动热泵
        const tEvap = tExhaustOut + 8.0; // 蒸发温度锚定在目标排烟温度 (假设使用了中间回路)
        const tCond = effectiveTargetT + 5.0; // 冷凝温度
        
        if (tEvap >= tCond - 2) {
             cop = 20.0; 
        } else {
            const tk_evap = tEvap + 273.15;
            const tk_cond = tCond + 273.15;
            let cop_carnot = tk_cond / (tk_cond - tk_evap);
            if (cop_carnot > 15) cop_carnot = 15;
            
            // 针对高温升的额外惩罚 (Direct Gen 模式)
            let liftPenalty = 1.0;
            if (steamStrategy === 'STRATEGY_GEN' && (tCond - tEvap) > 80) {
                liftPenalty = 0.85; // 高温升压缩效率衰减
            }

            cop = cop_carnot * eta * liftPenalty;
            if (cop < 1.5) cop = 1.5; 
            if (cop > 8.0) cop = 8.0;
        }
    } else {
        // 吸收式热泵
        if (steamStrategy === 'STRATEGY_GEN') {
            cop = 1.45; // 产蒸汽 COP 较低
        } else {
            cop = 1.70; // 产热水/预热 COP 较高
        }
    }

    // 6. 计算驱动能耗
    const driveEnergyKW = recoveredHeatActual / (recoveryType === 'ELECTRIC_HP' ? cop : cop); 
    // 注：如果是吸收式第一类，recoveredHeat = output. 
    // 定义：COP = Output / Input. => Input = Output / COP.
    // 但通常吸收式 COP 定义为 (Evap+Gen)/Gen = 1.7
    // Output = Source + Drive. 
    // Drive = Source / (COP - 1). 
    // 让我们统一用 Source based calculation:
    // SourcePart = recoveredHeatActual * ( (COP-1)/COP )
    // DrivePart  = recoveredHeatActual / COP
    // 这里代码原本的逻辑是：outputHeatKW = source + drive. 
    // recoveredHeatActual 这里指 Output (供给侧增量).
    
    // 修正计算：
    // DriveInput = Output / COP
    const driveInputKW = recoveredHeatActual / cop;
    const sourceConsumedKW = recoveredHeatActual - driveInputKW;

    // 水回收量 (kg/h) - 仅当实际排烟温度低于露点时
    let waterRecovery_kg_h = 0;
    if (exhaustOutActual < dbFuel.dewPoint) {
        // 简算：根据潜热比例反推
        // 这部分比较复杂，暂时按比例估算
        // 假设 latent 占比随温度线性变化
        if (latentPotential > 0) {
             const ratio = recoveredHeatActual / qSourcePotential; // 回收比例
             // 粗略估算水回收
             waterRecovery_kg_h = (latentPotential * ratio * 3600) / 2260; 
        }
    }

    return {
        recoveredHeat: recoveredHeatActual, // 输出给工艺的热量
        driveEnergy: driveInputKW,          // 消耗的驱动能量 (电或热)
        cop: parseFloat(cop.toFixed(2)),
        waterRecovery: parseFloat((waterRecovery_kg_h / 1000).toFixed(2)), 
        exhaustOutActual: parseFloat(exhaustOutActual.toFixed(1)),
        sinkLimited: (qSourcePotential > qSinkLimit) // 标记是否受热汇限制
    };
}

// v7.9: calculateHybridStrategy (透传参数)
export function calculateHybridStrategy(params) {
    const { 
        loadKW, topology, annualHours,
        elecPrice, fuelPrice, fuelTypeKey,
        customCalorific, calUnit, customCo2, co2Unit, customEfficiency,
        tExhaustIn, tExhaustOut, recoveryType, targetWaterTemp,
        capexHP, capexBase, pefElec, cop, manualCop,
        perfectionDegree,
        steamStrategy, tFeed, tPre // v7.9 新参数
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
            fuelCalVal: activeCalVal,
            perfectionDegree,
            steamStrategy, tFeed, tPre // 🟢 透传
        });

        // 经济性计算：节省了燃料成本，增加了驱动成本
        // savedFuelCost: 热泵产出的热量 (recoveredHeat) 替代了锅炉燃料
        // 注意：如果 BoilerEff < 1, 1kWh 热量需要 >1kWh 燃料。
        const savedFuelCost = (recRes.recoveredHeat / activeEff / activeCalVal) * fuelPrice;
        
        let driveCost = 0;
        let driveCo2 = 0;
        let drivePrimary = 0;

        if (recoveryType === 'ELECTRIC_HP') {
            driveCost = recRes.driveEnergy * elecPrice;
            driveCo2 = recRes.driveEnergy * FuelDatabase['ELECTRICITY'].co2Factor;
            drivePrimary = recRes.driveEnergy * pefElec;
        } else {
            // 吸收式驱动热源 (燃气/蒸汽)
            // 假设驱动热源效率与主锅炉一致 (最简模型)
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

        // PER 计算: 总产出 / 总一次能源输入
        // 总输入 = 基准输入 - 替代掉的 + 驱动用的
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
            
            // v7.9 附加信息
            exhaustOutActual: recRes.exhaustOutActual,
            sinkLimited: recRes.sinkLimited,
            
            comparison: { hpCost: 0, boilerCost: baselineCost, hpCo2: 0, boilerCo2: baselineCo2 }
        };

    } else {
        // ... (方案 A/B 逻辑保持不变) ...
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
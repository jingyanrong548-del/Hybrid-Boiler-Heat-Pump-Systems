// src/models/System.js
import { Boiler } from './Boiler.js';
import { HeatPump } from './HeatPump.js';
import { TOPOLOGY, LIMITS, FUEL_DB, RECOVERY_TYPES, MODES, STRATEGIES } from '../core/constants.js';
import { getSatTempFromPressure, estimateEnthalpy } from '../core/physics.js';
import { calculateCOP } from '../core/cycles.js';

export class System {
    constructor(state) {
        this.state = state;
    }

    simulate() {
        const s = this.state;
        if (s.topology === TOPOLOGY.RECOVERY && s.flueIn < LIMITS.MIN_FLUE_TEMP) {
            return { error: `排烟温度过低 (<${LIMITS.MIN_FLUE_TEMP}°C)，无回收价值` };
        }

        // === 数据清洗与防呆逻辑 ===
        let effectiveFuelPrice = s.fuelPrice;
        let effectiveCo2 = s.fuelCo2Value;
        let effectiveLHV = s.fuelCalValue;
        let effectiveEff = s.boilerEff;

        // 🔧 修复：热值单位归一化（确保统一为MJ/unit）
        // 无论用户选什么单位，我们根据数值大小和单位判断是否需要转换
        const fuelData = FUEL_DB[s.fuelType] || FUEL_DB['NATURAL_GAS'];
        const defaultLHV = fuelData.calorificValue; // MJ/unit
        
        // 判定条件：
        // 1. 明确选了 kWh 单位
        const isUnitKWh = s.fuelCalUnit && s.fuelCalUnit.includes('kWh');
        // 2. 或者：选了天然气，且数值小于 20 (说明填的是 ~10 kWh，而不是 ~36 MJ)
        // 3. 或者：数值明显小于默认值的一半（很可能是kWh单位）
        const isLowValue = (s.fuelType === 'NATURAL_GAS' && effectiveLHV < 20) || 
                          (effectiveLHV < defaultLHV * 0.6);
        
        if (isUnitKWh || isLowValue) {
            const originalLHV = effectiveLHV;
            effectiveLHV = effectiveLHV * 3.6;
            console.log(`🔧 热值单位转换:`, {
                "原始值": originalLHV,
                "原始单位": s.fuelCalUnit || "未知",
                "转换原因": isUnitKWh ? "单位是kWh" : "检测到输入值可能是kWh量级",
                "默认热值": defaultLHV.toFixed(1) + " MJ/" + fuelData.unit,
                "转换后值": effectiveLHV.toFixed(1),
                "转换后单位": "MJ/" + fuelData.unit
            });
        }

        if (s.fuelType === 'ELECTRICITY') {
            effectiveFuelPrice = s.elecPrice;
            if (effectiveCo2 < 0.3) effectiveCo2 = FUEL_DB['ELECTRICITY'].co2Factor;
            if (effectiveEff < 0.95) effectiveEff = 0.99;
        }

        const boiler = new Boiler({
            fuelType: s.fuelType, 
            efficiency: effectiveEff, 
            loadKW: s.loadValue, 
            flueIn: s.flueIn, 
            flueOut: s.flueOut,
            excessAir: s.excessAir,       
            fuelCalValue: effectiveLHV, 
            fuelCo2Value: effectiveCo2,
            fuelCo2Unit: s.fuelCo2Unit || 'kgCO2/unit'  // 🔧 修复：传递CO2因子单位
        });
        
        const baseline = boiler.calculateBaseline(effectiveFuelPrice);

        if (s.topology === TOPOLOGY.RECOVERY) {
            return this.runRecoverySimulation(boiler, baseline, effectiveFuelPrice);
        } else {
            return this.runStandardSimulation(boiler, baseline, effectiveFuelPrice);
        }
    }

    _makeDecision(annualSaving, payback) {
        const saveWan = annualSaving / 10000;
        let d = {
            winner: 'BASE',
            level: 'NEGATIVE',
            title: "🛑 不推荐 (Not Recommended)",
            desc: `当前工况下，热泵运行成本将高出 ${Math.abs(saveWan).toFixed(1)} 万元/年`,
            gainWan: saveWan,
            class: "bg-orange-50 border-orange-200 text-orange-800"
        };

        if (annualSaving > 0) {
            d.winner = 'HP';
            d.gainWan = saveWan;
            if (payback < 4.0) {
                d.level = 'STRONG';
                d.title = "🏆 强力推荐 (Highly Recommended)";
                d.desc = `相比对比燃料，每年产生纯收益 ${saveWan.toFixed(1)} 万元，预计 ${payback.toFixed(1)} 年回本。`; 
                d.class = "bg-emerald-50 border-emerald-200 text-emerald-800";
            } else {
                d.level = 'MARGINAL';
                d.title = "⚖️ 建议考虑 (Consider)";
                d.desc = `虽然每年节省 ${saveWan.toFixed(1)} 万元，但投资回收期较长 (${payback.toFixed(1)} 年)。`;
                d.class = "bg-blue-50 border-blue-200 text-blue-800";
            }
        }
        return d;
    }

    // === [Fix] 修正耦合数据计算逻辑 (区分电/吸收式) ===
    _calculateCouplingData(s, hpRes, boiler) {
        const totalLoad = s.loadValue; 
        const hpOutput = hpRes.recoveredHeat;
        const boilerOutput = totalLoad - hpOutput;
        
        const boilerInputFuel = boilerOutput / s.boilerEff; 
        
        // 区分驱动能量类型
        let siteInputTotal, primaryInputTotal;
        const pefFuel = 1.05;

        if (s.recoveryType === RECOVERY_TYPES.MVR) {
            // MVR: 驱动也是电
            const hpInputElec = hpRes.driveEnergy;
            const pefElec = s.pefElec || 2.5;
            
            siteInputTotal = boilerInputFuel + hpInputElec;
            primaryInputTotal = (boilerInputFuel * pefFuel) + (hpInputElec * pefElec);
        } else {
            // [Fix] Absorption: 驱动是热(燃料)，不是电
            // 需要先把热泵驱动热量(kW)换算回燃料输入(kW)
            const hpInputHeat = hpRes.driveEnergy; // kW heat needed
            const hpInputFuel = hpInputHeat / s.boilerEff; // 假设由锅炉提供驱动热
            
            siteInputTotal = boilerInputFuel + hpInputFuel;
            // 都是燃料，统一用 PEF_Fuel
            primaryInputTotal = (boilerInputFuel + hpInputFuel) * pefFuel;
        }
        
        const siteEffBefore = s.boilerEff; 
        const siteEffAfter = totalLoad / siteInputTotal;
        
        const perBefore = s.boilerEff / pefFuel;
        const perAfter = totalLoad / primaryInputTotal;

        return {
            site: {
                before: siteEffBefore * 100, 
                after: siteEffAfter * 100,   
                delta: (siteEffAfter - siteEffBefore) * 100 
            },
            per: {
                before: perBefore,
                after: perAfter,
                delta: perAfter - perBefore
            }
        };
    }

    runRecoverySimulation(boiler, baseline, effectiveFuelPrice) {
        const s = this.state;
        const sourcePot = boiler.calculateSourcePotential();
        
        let sysTargetT = (s.mode === MODES.STEAM) ? getSatTempFromPressure(s.targetTemp) : s.loadOut; 
        
        const h_target = estimateEnthalpy(sysTargetT, s.mode === MODES.STEAM);
        const h_in = estimateEnthalpy(s.loadIn, false);
        
        let sysMassFlow = 0;
        if (h_target > h_in + 1.0) {
            sysMassFlow = s.loadValue / (h_target - h_in); 
        } else {
            return { error: "系统进出水温差过小，无法计算有效流量" };
        }

        const hp = new HeatPump({
            recoveryType: s.recoveryType, 
            mode: s.mode, 
            strategy: s.steamStrategy,
            perfectionDegree: s.perfectionDegree, 
            totalLoadKW: s.loadValue,
            isManualCop: s.isManualCop, 
            manualCop: s.manualCop
        });

        const thermalDemand = { loadIn: s.loadIn, massFlow: sysMassFlow, targetTemp: sysTargetT };
        const hpRes = hp.simulate(sourcePot, thermalDemand);
        if (hpRes.error) return hpRes;

        // --- 经济性计算 ---
        // 修正逻辑: 计算燃料成本前，必须先进行 [kW -> Unit] 的换算
        const savedFuelEnergyMJ = (hpRes.recoveredHeat / s.boilerEff) * 3.6;
        const savedFuelUnits = savedFuelEnergyMJ / boiler.getCalorificValue();
        const savedFuelCost = savedFuelUnits * effectiveFuelPrice;
        
        let driveCost = 0, driveCo2 = 0, drivePrimary = 0;
        
        if (s.recoveryType === RECOVERY_TYPES.MVR) {
            driveCost = hpRes.driveEnergy * s.elecPrice;
            driveCo2 = hpRes.driveEnergy * FUEL_DB['ELECTRICITY'].co2Factor;
            drivePrimary = hpRes.driveEnergy * (s.pefElec || 2.5);
        } else {
            // === [CRITICAL FIX] 吸收式热泵的碳排放计算修复 ===
            const driveInputHeat = hpRes.driveEnergy; // kW
            const driveInputFuelKW = driveInputHeat / s.boilerEff; // kW fuel input
            
            // 1. 先把 kW 换算成 MJ
            const driveInputMJ = driveInputFuelKW * 3.6; 
            // 2. 再换算成 燃料单位 (m3 或 kg)
            const driveFuelUnits = driveInputMJ / boiler.getCalorificValue();
            
            // 3. 最后计算成本和碳排放
            driveCost = driveFuelUnits * effectiveFuelPrice;
            driveCo2 = driveFuelUnits * boiler.fuelData.co2Factor; // 现在单位对齐了 (units * kg/unit)
            
            drivePrimary = driveInputFuelKW * 1.05;
        }

        const hourlySaving = savedFuelCost - driveCost;
        const annualSaving = hourlySaving * s.annualHours;
        const totalInvest = hpRes.recoveredHeat * s.capexHP;
        const payback = (annualSaving > 0) ? (totalInvest / annualSaving) : 99;
        
        // 🔧 修复：计算 CO2 减排率（改为直接计算方式，逻辑更清晰）
        // 基准系统（纯粹锅炉）：提供总负荷的CO2排放
        const baselineCo2PerHour = baseline.co2PerHour;
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/8d595749-f587-4ed5-9402-4cdd0306ec71',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'System.js:196',message:'CO2计算开始(JS)',data:{baselineCo2PerHour,loadValue:s.loadValue,recoveredHeat:hpRes.recoveredHeat},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        
        // 耦合系统（锅炉+热泵）：直接计算实际CO2排放
        // 1. 计算锅炉实际需要提供的负荷
        const boilerLoadKW = s.loadValue - hpRes.recoveredHeat;  // 锅炉实际负荷
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/8d595749-f587-4ed5-9402-4cdd0306ec71',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'System.js:202',message:'锅炉负荷计算(JS)',data:{boilerLoadKW,loadValue:s.loadValue,recoveredHeat:hpRes.recoveredHeat,boilerEff:s.boilerEff},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        
        // 2. 计算锅炉实际CO2排放
        const boilerInputKW = boilerLoadKW / s.boilerEff;
        const boilerInputMJ = boilerInputKW * 3.6;
        const boilerFuelUnits = boilerInputMJ / boiler.getCalorificValue();
        const boilerCo2 = boilerFuelUnits * boiler.fuelData.co2Factor;  // 锅炉CO2 (kg/h)
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/8d595749-f587-4ed5-9402-4cdd0306ec71',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'System.js:208',message:'锅炉CO2计算(JS)',data:{boilerInputKW,boilerInputMJ,boilerFuelUnits,boilerCo2,calorificValue:boiler.getCalorificValue(),co2Factor:boiler.fuelData.co2Factor},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        
        // 3. 耦合系统总CO2 = 锅炉CO2 + 热泵驱动CO2
        const currentCo2 = boilerCo2 + driveCo2;
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/8d595749-f587-4ed5-9402-4cdd0306ec71',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'System.js:212',message:'耦合系统CO2计算(JS)',data:{boilerCo2,driveCo2,currentCo2},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        
        // 4. 计算减排率 = (基准CO2 - 耦合CO2) / 基准CO2 * 100
        const co2Reduction = ((baselineCo2PerHour - currentCo2) / baselineCo2PerHour) * 100;
        
        // 🔧 调试：输出方案C CO2计算详情
        const fuelData = FUEL_DB[s.fuelType] || FUEL_DB['NATURAL_GAS'];
        const effectiveCo2Factor = boiler.fuelData.co2Factor;
        console.log("═══════════════════════════════════════════════════════");
        console.log("📊 方案C CO2计算详情");
        console.log("═══════════════════════════════════════════════════════");
        console.log(`方案类型: 方案C (烟气余热回收)`);
        console.log(`总负荷: ${s.loadValue.toFixed(2)} kW`);
        console.log(`热泵回收热量: ${hpRes.recoveredHeat.toFixed(2)} kW`);
        console.log(`锅炉实际负荷: ${boilerLoadKW.toFixed(2)} kW`);
        console.log(`锅炉效率: ${s.boilerEff.toFixed(2)}`);
        console.log("───────────────────────────────────────────────────────");
        console.log("🔢 碳排放值:");
        console.log(`  对比能源碳排放值: ${baselineCo2PerHour.toFixed(2)} kg/h`);
        console.log(`  耦合系统碳排放值: ${currentCo2.toFixed(2)} kg/h`);
        console.log(`    - 锅炉CO2: ${boilerCo2.toFixed(2)} kg/h`);
        console.log(`    - 热泵驱动CO2: ${driveCo2.toFixed(2)} kg/h`);
        console.log(`  减排率: ${co2Reduction.toFixed(2)}%`);
        console.log("───────────────────────────────────────────────────────");
        console.log("📐 计算公式:");
        console.log(`  减排率 = (${baselineCo2PerHour.toFixed(2)} - ${currentCo2.toFixed(2)}) / ${baselineCo2PerHour.toFixed(2)} × 100`);
        console.log("📐 验证计算:");
        console.log(`  基准CO2: 总负荷 ${s.loadValue.toFixed(2)} kW / 效率 ${s.boilerEff.toFixed(2)} = ${baseline.inputKW.toFixed(2)} kW输入`);
        console.log(`  耦合CO2: 锅炉 ${boilerCo2.toFixed(2)} + 热泵驱动 ${driveCo2.toFixed(2)} = ${currentCo2.toFixed(2)} kg/h`);
        console.log("═══════════════════════════════════════════════════════");
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/8d595749-f587-4ed5-9402-4cdd0306ec71',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'System.js:216',message:'减排率计算(JS)',data:{baselineCo2PerHour,currentCo2,co2Reduction,formula:`(${baselineCo2PerHour}-${currentCo2})/${baselineCo2PerHour}*100`},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        
        const per = (drivePrimary > 0) ? (hpRes.recoveredHeat / drivePrimary) : 0;

        const couplingData = this._calculateCouplingData(s, hpRes, boiler);
        
        const limitReason = hpRes.isSinkLimited 
            ? { type: 'SINK', text: '💧 Sink Limited (水侧温升受限)' }
            : { type: 'SOURCE', text: '🔥 Source Limited (烟气热量榨干)' };

        const decision = this._makeDecision(annualSaving, payback);
        let recommendation = decision.winner === 'HP' 
            ? `✅ 建议采用热泵 (预计年省 ${decision.gainWan.toFixed(1)} 万元)` 
            : `⚠️ 建议维持锅炉 (热泵方案预计年亏 ${Math.abs(decision.gainWan).toFixed(1)} 万元)`;

        const reqData = {
            sourceType: `烟气 (Flue Gas) @ ${s.flueIn}°C`,
            sourceIn: s.flueIn,
            sourceOut: hpRes.actualFlueOut || s.flueOut, 
            loadType: s.mode === MODES.STEAM ? (s.steamStrategy === STRATEGIES.GEN ? "蒸汽 (Steam)" : "补水预热 (Pre-heat)") : "热水 (Hot Water)",
            loadIn: s.loadIn,
            loadOut: hpRes.actualLoadOut, 
            capacity: hpRes.recoveredHeat
        };

        return {
            mode: "余热回收 (Deep Recovery)",
            cop: hpRes.cop, 
            lift: hpRes.lift, 
            recoveredHeat: hpRes.recoveredHeat,
            annualSaving, 
            payback, 
            costPerHour: baseline.costPerHour - hourlySaving,
            co2ReductionRate: co2Reduction,
            baselineCo2: baselineCo2PerHour,  // 🔧 调试：对比能源碳排放值 (kg/h)
            currentCo2: currentCo2,  // 🔧 调试：耦合系统碳排放值 (kg/h)
            per,
            recommendation, 
            decision, 
            couplingData, 
            limitReason,
            tonData: { total: s.loadValue/700, hp: hpRes.recoveredHeat/700, boiler: (s.loadValue-hpRes.recoveredHeat)/700 },
            reqData 
        };
    }

    runStandardSimulation(boiler, baseline, effectiveFuelPrice) {
        const s = this.state;
        const targetT = (s.mode === MODES.STEAM) ? getSatTempFromPressure(s.targetTemp) : s.targetTemp;
        
        let tSourceIn, tSourceOut, sourceType, tEvap;

        if (s.topology === TOPOLOGY.PARALLEL) {
            tSourceIn = s.sourceTemp;
            tSourceOut = tSourceIn - 5.0;  // 🔧 修改：进出风温差改为5度
            tEvap = tSourceOut - 5.0;      // 🔧 修改：蒸发温度与出风温度差值5度
            sourceType = "室外空气 (Ambient Air)";
        } else {
            tSourceIn = s.sourceTemp;       
            tSourceOut = s.sourceOut;
            tEvap = tSourceOut - 5.0;        
            sourceType = "余热水源 (Waste Water)";
        }
        
        const tCond = targetT + 5.0;    

        let cycle;
        if (s.isManualCop && s.manualCop > 0) {
            cycle = { cop: s.manualCop, lift: tCond - tEvap, error: null };
        } else {
            cycle = calculateCOP({
                evapTemp: tEvap, 
                condTemp: tCond, 
                efficiency: s.perfectionDegree,
                mode: s.mode, 
                strategy: s.steamStrategy, 
                recoveryType: RECOVERY_TYPES.MVR
            });
        }
        
        if (cycle.error) return cycle;

        const hpCapacity = s.loadValue; 
        const powerInput = hpCapacity / cycle.cop;
        const hpCost = powerInput * s.elecPrice;
        const hpCo2 = powerInput * FUEL_DB['ELECTRICITY'].co2Factor;
        const pef = s.pefElec || 2.5;
        const per = (powerInput * pef > 0) ? (hpCapacity / (powerInput * pef)) : 0;

        const hourlySaving = baseline.costPerHour - hpCost;
        const annualSaving = hourlySaving * s.annualHours;
        const capexDiff = s.loadValue * (s.capexHP - s.capexBase);
        const payback = (annualSaving > 0) ? (capexDiff / annualSaving) : 99;

        // 🔧 修复：计算碳减排率
        // 基准系统（纯锅炉）：提供总负荷的CO2排放
        const baselineCo2PerHour = baseline.co2PerHour;
        // 热泵系统：完全替代锅炉，只产生驱动电力的CO2
        const hpSystemCo2 = hpCo2;
        
        // 🔧 验证：确保基准CO2不为零
        if (baselineCo2PerHour <= 0) {
            console.error("❌ 错误：基准CO2为零或负值，无法计算减排率");
            return { error: "基准CO2计算错误，无法计算减排率" };
        }
        
        // 减排率 = (基准CO2 - 热泵CO2) / 基准CO2 × 100%
        // 正值表示减排，负值表示增排
        const co2Reduction = ((baselineCo2PerHour - hpSystemCo2) / baselineCo2PerHour) * 100;
        
        // 🔧 调试日志：输出CO2计算详情
        const fuelData = FUEL_DB[s.fuelType] || FUEL_DB['NATURAL_GAS'];
        const effectiveCo2Factor = boiler.fuelData.co2Factor; // 使用转换后的CO2因子（已处理单位转换）
        const userCo2Unit = s.fuelCo2Unit || 'kgCO2/unit';
        const userCo2Value = s.fuelCo2Value || fuelData.co2Factor;
        
        console.log("═══════════════════════════════════════════════════════");
        console.log("📊 方案A/B CO2计算详情");
        console.log("═══════════════════════════════════════════════════════");
        console.log(`方案类型: ${s.topology === TOPOLOGY.PARALLEL ? "方案A (空气源)" : "方案B (余热水源)"}`);
        console.log(`基准负荷: ${s.loadValue.toFixed(2)} kW`);
        console.log(`锅炉效率: ${s.boilerEff.toFixed(2)}`);
        console.log(`基准燃料输入功率: ${baseline.inputKW.toFixed(2)} kW`);
        console.log(`基准燃料消耗: ${baseline.fuelRate.toFixed(4)} ${fuelData.unit}/h`);
        console.log(`用户输入CO2因子: ${userCo2Value.toFixed(4)} ${userCo2Unit}`);
        console.log(`转换后CO2因子: ${effectiveCo2Factor.toFixed(4)} kg/${fuelData.unit}`);
        console.log("───────────────────────────────────────────────────────");
        console.log("🔢 碳排放值:");
        console.log(`  对比能源碳排放值: ${baselineCo2PerHour.toFixed(2)} kg/h`);
        console.log(`  热泵系统碳排放值: ${hpSystemCo2.toFixed(2)} kg/h`);
        console.log(`  减排率: ${co2Reduction.toFixed(2)}%`);
        console.log("───────────────────────────────────────────────────────");
        console.log("📐 计算公式:");
        console.log(`  减排率 = (${baselineCo2PerHour.toFixed(2)} - ${hpSystemCo2.toFixed(2)}) / ${baselineCo2PerHour.toFixed(2)} × 100`);
        console.log("📐 验证计算:");
        const actualCalValue = boiler.getCalorificValue(); // 使用实际使用的热值（已转换）
        console.log(`  基准CO2 = ${baseline.inputKW.toFixed(2)} kW × 3.6 / ${actualCalValue.toFixed(1)} MJ/${fuelData.unit} × ${effectiveCo2Factor.toFixed(4)} kg/${fuelData.unit} = ${baselineCo2PerHour.toFixed(2)} kg/h`);
        console.log(`  热泵CO2 = ${powerInput.toFixed(2)} kW × ${FUEL_DB['ELECTRICITY'].co2Factor.toFixed(4)} kg/kWh = ${hpSystemCo2.toFixed(2)} kg/h`);
        console.log("═══════════════════════════════════════════════════════");
        console.log("📋 关键参数验证:");
        console.log(`  默认热值: ${fuelData.calorificValue.toFixed(1)} MJ/${fuelData.unit}`);
        console.log(`  实际使用热值: ${actualCalValue.toFixed(1)} MJ/${fuelData.unit}`);
        console.log(`  默认CO2因子: ${fuelData.co2Factor.toFixed(4)} kg/${fuelData.unit}`);
        console.log(`  实际使用CO2因子: ${effectiveCo2Factor.toFixed(4)} kg/${fuelData.unit}`);
        console.log("═══════════════════════════════════════════════════════");
        
        // 🔧 验证：检查计算是否合理
        if (co2Reduction < -50) {
            console.warn("⚠️ 警告：碳减排率为负且绝对值很大，请检查计算逻辑！");
            console.warn("   可能原因：电力CO2因子过高，或基准燃料CO2因子设置错误");
        }

        const decision = this._makeDecision(annualSaving, payback);
        let recommendation = decision.winner === 'HP' 
            ? `✅ 建议采用热泵 (预计年省 ${decision.gainWan.toFixed(1)} 万元)` 
            : `⚠️ 建议维持锅炉 (热泵方案预计年亏 ${Math.abs(decision.gainWan).toFixed(1)} 万元)`;

        const reqData = {
            sourceType: sourceType,
            sourceIn: tSourceIn,
            sourceOut: tSourceOut,
            loadType: s.mode === MODES.STEAM ? "蒸汽 (Steam)" : "热水 (Hot Water)",
            loadIn: s.loadInStd, 
            loadOut: targetT,
            capacity: hpCapacity
        };

        return {
            mode: "标准热泵",
            cop: cycle.cop, 
            lift: cycle.lift, 
            recoveredHeat: hpCapacity,
            annualSaving, 
            payback, 
            costPerHour: hpCost,
            co2ReductionRate: co2Reduction,  // 🔧 修复：使用明确的计算值
            baselineCo2: baselineCo2PerHour,  // 🔧 调试：对比能源碳排放值 (kg/h)
            hpSystemCo2: hpSystemCo2,  // 🔧 调试：热泵系统碳排放值 (kg/h)
            per,
            recommendation, 
            decision, 
            tonData: { total: s.loadValue/700, hp: s.loadValue/700, boiler: 0.0 },
            reqData 
        };
    }
}
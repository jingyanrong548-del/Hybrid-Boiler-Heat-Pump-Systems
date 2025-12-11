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
            fuelCo2Value: effectiveCo2 
        });
        
        const baseline = boiler.calculateBaseline(effectiveFuelPrice);

        if (s.topology === TOPOLOGY.RECOVERY) {
            return this.runRecoverySimulation(boiler, baseline, effectiveFuelPrice);
        } else {
            return this.runStandardSimulation(baseline, effectiveFuelPrice);
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
        
        const baselineCo2PerHour = baseline.co2PerHour; 
        
        // 计算替代掉的 CO2 也要用同样的严谨逻辑
        const hpReplacedCo2 = savedFuelUnits * boiler.fuelData.co2Factor;
        
        const currentCo2 = (baselineCo2PerHour - hpReplacedCo2) + driveCo2;
        const co2Reduction = ((baselineCo2PerHour - currentCo2) / baselineCo2PerHour) * 100;
        
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
            per,
            recommendation, 
            decision, 
            couplingData, 
            limitReason,
            tonData: { total: s.loadValue/700, hp: hpRes.recoveredHeat/700, boiler: (s.loadValue-hpRes.recoveredHeat)/700 },
            reqData 
        };
    }

    runStandardSimulation(baseline, effectiveFuelPrice) {
        const s = this.state;
        const targetT = (s.mode === MODES.STEAM) ? getSatTempFromPressure(s.targetTemp) : s.targetTemp;
        
        let tSourceIn, tSourceOut, sourceType, tEvap;

        if (s.topology === TOPOLOGY.PARALLEL) {
            tSourceIn = s.sourceTemp;
            tEvap = tSourceIn - 8.0; 
            tSourceOut = tSourceIn - 3.0; 
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
            co2ReductionRate: ((baseline.co2PerHour - hpCo2) / baseline.co2PerHour) * 100,
            per,
            recommendation, 
            decision, 
            tonData: { total: s.loadValue/700, hp: s.loadValue/700, boiler: 0.0 },
            reqData 
        };
    }
}
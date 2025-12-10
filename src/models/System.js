// src/models/System.js
import { Boiler } from './Boiler.js';
import { HeatPump } from './HeatPump.js';
import { TOPOLOGY, LIMITS, FUEL_DB, RECOVERY_TYPES, MODES, STRATEGIES } from '../core/constants.js';
import { getSatTempFromPressure } from '../core/physics.js';
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

        const boiler = new Boiler({
            fuelType: s.fuelType, efficiency: s.boilerEff, loadKW: s.loadValue, flueIn: s.flueIn, flueOut: s.flueOut,
            excessAir: s.excessAir, // v9.1 Pass Alpha
            fuelCalValue: s.fuelCalValue, // v9.1 Pass LHV Override
            fuelCo2Value: s.fuelCo2Value // v9.1 Pass CO2 Override
        });
        const baseline = boiler.calculateBaseline(s.fuelPrice);

        if (s.topology === TOPOLOGY.RECOVERY) {
            return this.runRecoverySimulation(boiler, baseline);
        } else {
            return this.runStandardSimulation(baseline);
        }
    }

    runRecoverySimulation(boiler, baseline) {
        const s = this.state;
        const sourcePot = boiler.calculateSourcePotential();
        const targetT = (s.mode === MODES.STEAM) ? getSatTempFromPressure(s.targetTemp) : s.targetTemp;
        
        const hp = new HeatPump({
            recoveryType: s.recoveryType, mode: s.mode, strategy: s.steamStrategy,
            perfectionDegree: s.perfectionDegree, totalLoadKW: s.loadValue
        });

        const hpRes = hp.simulate(sourcePot, { loadIn: s.loadIn, loadOut: s.loadOut, targetTemp: targetT });
        if (hpRes.error) return hpRes;

        // 经济性
        const savedFuelCost = (hpRes.recoveredHeat / s.boilerEff / boiler.getCalorificValue()) * s.fuelPrice;
        let driveCost = 0, driveCo2 = 0, drivePrimary = 0;
        
        if (s.recoveryType === RECOVERY_TYPES.MVR) {
            driveCost = hpRes.driveEnergy * s.elecPrice;
            driveCo2 = hpRes.driveEnergy * FUEL_DB['ELECTRICITY'].co2Factor;
            drivePrimary = hpRes.driveEnergy * (s.pefElec || 2.5);
        } else {
            const driveInputFuel = hpRes.driveEnergy / s.boilerEff;
            driveCost = (driveInputFuel / boiler.getCalorificValue()) * s.fuelPrice;
            driveCo2 = driveInputFuel * boiler.fuelData.co2Factor;
            drivePrimary = driveInputFuel * 1.05;
        }

        const hourlySaving = savedFuelCost - driveCost;
        const annualSaving = hourlySaving * s.annualHours;
        const totalInvest = hpRes.recoveredHeat * s.capexHP;
        const payback = (annualSaving > 0) ? (totalInvest / annualSaving) : 99;
        // 使用实际燃料数据进行CO2计算
        const baselineCo2PerHour = (s.loadValue / s.boilerEff / boiler.getCalorificValue()) * boiler.fuelData.co2Factor; 
        const hpReplacedCo2 = (hpRes.recoveredHeat / s.boilerEff / boiler.getCalorificValue()) * boiler.fuelData.co2Factor;

        const currentCo2 = (baselineCo2PerHour - hpReplacedCo2) + driveCo2;
        const co2Reduction = ((baselineCo2PerHour - currentCo2) / baselineCo2PerHour) * 100;
        const per = (drivePrimary > 0) ? (hpRes.recoveredHeat / drivePrimary) : 0;

        // [FIX] 构造选型单数据 (Req Data)
        const reqData = {
            sourceType: `烟气 (Flue Gas) @ ${s.flueIn}°C`,
            sourceIn: s.flueIn,
            sourceOut: hpRes.actualFlueOut || s.flueOut, // 这里的 actualFlueOut 来自 HeatPump
            loadType: s.mode === MODES.STEAM ? (s.steamStrategy === STRATEGIES.GEN ? "蒸汽 (Steam)" : "补水预热 (Pre-heat)") : "热水 (Hot Water)",
            loadIn: s.loadIn,
            loadOut: s.loadOut, // 或者 targetT
            capacity: hpRes.recoveredHeat
        };

        return {
            mode: "余热回收 (Deep Recovery)",
            cop: hpRes.cop, lift: hpRes.lift, recoveredHeat: hpRes.recoveredHeat,
            annualSaving, payback, costPerHour: baseline.costPerHour - hourlySaving,
            co2ReductionRate: co2Reduction, per,
            tonData: { total: s.loadValue/700, hp: hpRes.recoveredHeat/700, boiler: (s.loadValue-hpRes.recoveredHeat)/700 },
            reqData // 返回数据
        };
    }

    runStandardSimulation(baseline) {
        const s = this.state;
        const targetT = (s.mode === MODES.STEAM) ? getSatTempFromPressure(s.targetTemp) : s.targetTemp;
        
        // 计算
        const tSource = s.sourceTemp; 
        const tEvap = tSource - 5.0; 
        const tCond = targetT + 5.0; 
        
        const cycle = calculateCOP({
            evapTemp: tEvap, condTemp: tCond, efficiency: s.perfectionDegree,
            mode: s.mode, strategy: s.steamStrategy, recoveryType: RECOVERY_TYPES.MVR
        });
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

        // [FIX] 构造选型单数据
        const reqData = {
            sourceType: s.topology === TOPOLOGY.PARALLEL ? "室外空气 (Ambient Air)" : "余热水源 (Waste Water)",
            sourceIn: s.sourceTemp,
            sourceOut: s.sourceTemp - 5, // 估算
            loadType: s.mode === MODES.STEAM ? "蒸汽 (Steam)" : "热水 (Hot Water)",
            loadIn: s.loadIn || 20,
            loadOut: targetT,
            capacity: hpCapacity
        };

        return {
            mode: "标准热泵",
            cop: cycle.cop, lift: cycle.lift, recoveredHeat: hpCapacity,
            annualSaving, payback, costPerHour: hpCost,
            co2ReductionRate: ((baseline.co2PerHour - hpCo2) / baseline.co2PerHour) * 100,
            per,
            tonData: { total: s.loadValue/700, hp: s.loadValue/700, boiler: 0.0 },
            reqData // 返回数据
        };
    }
}
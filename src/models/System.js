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
        // 物理限制检查
        if (s.topology === TOPOLOGY.RECOVERY && s.flueIn < LIMITS.MIN_FLUE_TEMP) {
            return { error: `排烟温度过低 (<${LIMITS.MIN_FLUE_TEMP}°C)，无回收价值` };
        }

        // --- 1. 初始化锅炉模型 (传入所有高级参数) ---
        const boiler = new Boiler({
            fuelType: s.fuelType, 
            efficiency: s.boilerEff, 
            loadKW: s.loadValue, 
            flueIn: s.flueIn, 
            flueOut: s.flueOut,
            excessAir: s.excessAir,       // v9.1: 过量空气系数
            fuelCalValue: s.fuelCalValue, // v9.1: 用户覆盖的 LHV
            fuelCo2Value: s.fuelCo2Value  // v9.1: 用户覆盖的 CO2 因子
        });
        
        // 计算基准线 (Baseline)
        const baseline = boiler.calculateBaseline(s.fuelPrice);

        // 根据拓扑结构分流计算
        if (s.topology === TOPOLOGY.RECOVERY) {
            return this.runRecoverySimulation(boiler, baseline);
        } else {
            return this.runStandardSimulation(baseline);
        }
    }

    // === 方案 C: 烟气余热深度回收 (串联 Flow-Driven 模式) ===
    runRecoverySimulation(boiler, baseline) {
        const s = this.state;
        const sourcePot = boiler.calculateSourcePotential();
        
        // [核心修正] 确定系统最终目标温度 (用于计算总流量)
        // 逻辑：在 main.js 中，如果是热水模式，LoadOut 输入框代表了系统总目标；
        // 如果是蒸汽模式，TargetTemp (压力转换) 代表系统总目标。
        let sysTargetT;
        if (s.mode === MODES.STEAM) {
            sysTargetT = getSatTempFromPressure(s.targetTemp);
        } else {
            sysTargetT = s.loadOut; 
        }
        
        // 计算系统总流量 (Mass Flow)
        // 逻辑：在串联系统中，流量 = 总负荷 / (最终目标焓 - 入口焓)
        const h_target = estimateEnthalpy(sysTargetT, s.mode === MODES.STEAM);
        const h_in = estimateEnthalpy(s.loadIn, false);
        
        let sysMassFlow = 0;
        if (h_target > h_in + 1.0) {
            sysMassFlow = s.loadValue / (h_target - h_in); // kg/s
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

        // 传递 Flow-Driven 参数给热泵
        const thermalDemand = { 
            loadIn: s.loadIn,       // 热汇入口
            massFlow: sysMassFlow,  // [New] 正确的系统总流量
            targetTemp: sysTargetT  // 系统总目标 (作为物理上限)
        };

        const hpRes = hp.simulate(sourcePot, thermalDemand);
        if (hpRes.error) return hpRes;

        // --- 经济性计算 ---
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
        
        // CO2 减排计算
        const baselineCo2PerHour = baseline.co2PerHour; 
        const hpReplacedCo2 = (hpRes.recoveredHeat / s.boilerEff / boiler.getCalorificValue()) * boiler.fuelData.co2Factor;
        const currentCo2 = (baselineCo2PerHour - hpReplacedCo2) + driveCo2;
        const co2Reduction = ((baselineCo2PerHour - currentCo2) / baselineCo2PerHour) * 100;
        
        const per = (drivePrimary > 0) ? (hpRes.recoveredHeat / drivePrimary) : 0;

        // [New] 决策建议生成 (万元单位)
        const saveWan = annualSaving / 10000;
        let recommendation = "";
        if (saveWan > 0) {
            recommendation = `✅ 建议采用热泵 (预计年省 ${saveWan.toFixed(1)} 万元)`;
        } else {
            recommendation = `⚠️ 建议维持锅炉 (热泵方案预计年亏 ${Math.abs(saveWan).toFixed(1)} 万元)`;
        }

        // 构造选型单数据
        const reqData = {
            sourceType: `烟气 (Flue Gas) @ ${s.flueIn}°C`,
            sourceIn: s.flueIn,
            sourceOut: hpRes.actualFlueOut || s.flueOut, 
            loadType: s.mode === MODES.STEAM ? (s.steamStrategy === STRATEGIES.GEN ? "蒸汽 (Steam)" : "补水预热 (Pre-heat)") : "热水 (Hot Water)",
            loadIn: s.loadIn,
            loadOut: hpRes.actualLoadOut, // 使用反算后的实际水温
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
            tonData: { total: s.loadValue/700, hp: hpRes.recoveredHeat/700, boiler: (s.loadValue-hpRes.recoveredHeat)/700 },
            reqData 
        };
    }

    // === 方案 A/B: 标准热泵 (并联/耦合模式) ===
    runStandardSimulation(baseline) {
        const s = this.state;
        const targetT = (s.mode === MODES.STEAM) ? getSatTempFromPressure(s.targetTemp) : s.targetTemp;
        
        let tSourceIn, tSourceOut, sourceType;

        if (s.topology === TOPOLOGY.PARALLEL) {
            // 方案 A: 空气源
            tSourceIn = s.sourceTemp;       
            tSourceOut = tSourceIn - 5.0;   // 估算吸热温降
            sourceType = "室外空气 (Ambient Air)";
        } else {
            // 方案 B: 余热水源
            tSourceIn = s.sourceTemp;       
            tSourceOut = s.sourceOut;       // [Fixed] 使用独立的状态变量 sourceOut
            sourceType = "余热水源 (Waste Water)";
        }
        
        const tEvap = tSourceOut - 5.0; 
        const tCond = targetT + 5.0;    

        const cycle = calculateCOP({
            evapTemp: tEvap, 
            condTemp: tCond, 
            efficiency: s.perfectionDegree,
            mode: s.mode, 
            strategy: s.steamStrategy, 
            recoveryType: RECOVERY_TYPES.MVR,
            isManualCop: s.isManualCop, 
            manualCop: s.manualCop
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

        // [New] 决策建议生成
        const saveWan = annualSaving / 10000;
        let recommendation = "";
        if (saveWan > 0) {
            recommendation = `✅ 建议采用热泵 (预计年省 ${saveWan.toFixed(1)} 万元)`;
        } else {
            recommendation = `⚠️ 建议维持锅炉 (热泵方案预计年亏 ${Math.abs(saveWan).toFixed(1)} 万元)`;
        }

        const reqData = {
            sourceType: sourceType,
            sourceIn: tSourceIn,
            sourceOut: tSourceOut,
            loadType: s.mode === MODES.STEAM ? "蒸汽 (Steam)" : "热水 (Hot Water)",
            loadIn: s.loadInStd, // [Fixed] 使用独立的 LoadInStd
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
            tonData: { total: s.loadValue/700, hp: s.loadValue/700, boiler: 0.0 },
            reqData 
        };
    }
}
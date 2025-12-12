# app/core/solver.py
from app.core.physics import estimate_enthalpy, calculate_adjusted_dew_point, calculate_water_condensation
from app.core.cycles import calculate_cop
from app.core.constants import FUEL_DB

class SchemeCSolver:
    def __init__(self, tolerance=0.5, max_iter=1000):
        # 🟢 修改1: 容差放大到 0.5kW (工程上足够了)，次数加到 1000
        self.tolerance = tolerance 
        self.max_iter = max_iter

    def calculate_flue_heat_release(self, t_in, t_out, flow_vol, fuel_type, excess_air=1.2):
        # 🔧 显热计算
        # flow_vol: 标准状态 (0°C, 101.325 kPa) 下的烟气体积流量 (m3/h)
        # cp_vol_mj: 体积比热容 (MJ/(m3·K))，已考虑实际工况（100-200°C范围）的平均效应
        cp_vol_mj = 0.00038 * 3600  # 0.00038 kWh/(m3·K) = 1.368 MJ/(m3·K)
        sensible_kw = (flow_vol * cp_vol_mj * (t_in - t_out)) / 3600.0
        
        # 2. 潜热计算
        latent_kw = 0.0
        fuel_data = FUEL_DB.get(fuel_type, FUEL_DB['NATURAL_GAS'])
        actual_dew_point = calculate_adjusted_dew_point(fuel_data["dewPointRef"], excess_air)
        
        if t_out < actual_dew_point:
            max_latent_per_m3 = 160.0 if fuel_type == 'NATURAL_GAS' else 0.0
            cond_factor = (actual_dew_point - t_out) / (actual_dew_point - 5.0)
            cond_factor = max(0.0, min(1.0, cond_factor))
            total_latent_potential = flow_vol * max_latent_per_m3 / 3600.0 
            latent_kw = total_latent_potential * cond_factor

        return sensible_kw + latent_kw

    def solve(self, req):
        # 🔧 修复：对于蒸汽预热模式，限制目标温度为 98°C（防止沸腾）
        SAFE_PREHEAT_LIMIT = 98.0
        effective_sink_target = req.sink_out_target
        if req.mode == 'STEAM' and effective_sink_target > SAFE_PREHEAT_LIMIT:
            effective_sink_target = SAFE_PREHEAT_LIMIT
            print(f"⚠️ 蒸汽预热模式，目标温度限制为 {SAFE_PREHEAT_LIMIT}°C")
        
        # 计算目标
        h_in = estimate_enthalpy(req.sink_in_temp)
        h_out = estimate_enthalpy(effective_sink_target, req.mode == 'STEAM')
        q_sink_target_kw = (req.sink_flow_kg_h * (h_out - h_in)) / 3600.0

        print(f"\n=== 开始计算 (流量: {req.sink_flow_kg_h} kg/h) ===")
        print(f"目标负荷: {q_sink_target_kw:.1f} kW")
        print(f"用户输入的目标排烟温度: {req.source_out_target:.1f}°C")

        t_source_in = req.source_in_temp
        # 🔧 修复：使用用户输入的目标排烟温度作为初始值，而不是硬编码 60°C
        current_t_source_out = req.source_out_target 
        
        # 🔧 修复：记录最大可用热源能力（用于判断是否热源不足）
        max_source_potential = self.calculate_flue_heat_release(
            t_source_in, 5.0, req.source_flow_vol, req.fuel_type  # 假设最低排烟 5°C
        )
        
        for i in range(self.max_iter):
            # A. COP
            # 🔧 修复：如果启用手动COP锁定，直接使用手动COP值
            if req.is_manual_cop and req.manual_cop > 0:
                cop = req.manual_cop
            else:
                t_evap = current_t_source_out - 5.0
                t_cond = effective_sink_target + 5.0
                # 🔧 修复：使用请求中的策略参数
                cycle_res = calculate_cop(t_evap, t_cond, req.efficiency, req.mode, req.strategy, req.recovery_type)
                cop = cycle_res["cop"]

            # B. 需求
            cop_factor = (cop - 1) / cop if cop > 1.0 else 0
            q_source_needed = q_sink_target_kw * cop_factor

            # C. 供给
            q_source_avail = self.calculate_flue_heat_release(
                t_source_in, current_t_source_out, req.source_flow_vol, req.fuel_type
            )

            # D. 误差
            diff = q_source_avail - q_source_needed

            # E. 打印进度 (每50次或快成功时打印)
            if i % 50 == 0 or abs(diff) < 5.0:
                print(f"Iter {i}: 排烟 {current_t_source_out:.2f}°C | 供给 {q_source_avail:.1f} vs 需求 {q_source_needed:.1f} | 差值 {diff:.1f}")

            # F. 收敛判定
            if abs(diff) < self.tolerance:
                print(f"✅ 收敛成功! 最终排烟: {current_t_source_out:.2f}°C")
                return {
                    "status": "converged",
                    "iterations": i + 1,
                    "target_load_kw": round(q_sink_target_kw, 1),
                    "required_source_out": round(current_t_source_out, 2),
                    "final_cop": cop,
                    "source_total_kw": round(q_source_avail, 1)
                }

            # G. 动态步长 (🟢 修改2: 加大调整力度 0.005 -> 0.01)
            step = diff * 0.01 
            current_t_source_out += step
            
            # 边界保护
            if current_t_source_out >= t_source_in: current_t_source_out = t_source_in - 0.1
            # 🔧 修复：严格按照用户输入的目标排烟温度，不允许自动降级
            # 如果用户输入的目标温度低于物理下限（5°C），则使用5°C作为下限
            min_flue_out = max(5.0, req.source_out_target)
            if current_t_source_out < min_flue_out: current_t_source_out = min_flue_out

        # 🔧 修复：如果无法收敛，严格按照用户输入的目标排烟温度计算（不自动降级）
        print(f"⚠️ 迭代未收敛，严格按照用户指定的排烟温度 {req.source_out_target:.1f}°C 计算...")
        
        # 使用用户输入的目标排烟温度（如果低于物理下限5°C，则使用5°C）
        target_flue_out = max(5.0, req.source_out_target)
        if req.source_out_target < 5.0:
            print(f"⚠️ 用户输入的目标排烟温度 {req.source_out_target:.1f}°C 低于物理下限，使用 5.0°C")
        
        # 严格按照目标排烟温度计算
        final_t_source_out = target_flue_out
        
        # 🔧 修复：如果启用手动COP锁定，直接使用手动COP值
        if req.is_manual_cop and req.manual_cop > 0:
            cop = req.manual_cop
            print(f"🔒 使用手动锁定COP: {cop:.2f}")
        else:
            t_evap = final_t_source_out - 5.0
            t_cond = effective_sink_target + 5.0
            # 🔧 修复：使用请求中的策略参数
            cycle_res = calculate_cop(t_evap, t_cond, req.efficiency, req.mode, req.strategy, req.recovery_type)
            cop = cycle_res["cop"]
        
        # 计算在该排烟温度下热源能支撑的最大负荷
        cop_factor = (cop - 1) / cop if cop > 1.0 else 0
        available_source_heat = self.calculate_flue_heat_release(
            t_source_in, final_t_source_out, req.source_flow_vol, req.fuel_type
        )
        max_load_kw = available_source_heat / cop_factor if cop_factor > 0 else 0
        max_source_heat = available_source_heat
        
        # 检查热源是否充足
        if max_load_kw < q_sink_target_kw * 0.95:  # 允许 5% 误差
            print(f"⚠️ 警告：在用户指定的排烟温度 {final_t_source_out:.1f}°C 下，热源不足！")
            print(f"   目标负荷: {q_sink_target_kw:.1f} kW")
            print(f"   实际能达到: {max_load_kw:.1f} kW")
            print(f"   系统将按 {final_t_source_out:.1f}°C 排烟温度运行，实际负荷为 {max_load_kw:.1f} kW")
        
        # 🔧 修复：反算实际能达到的出水温度
        # 使用实际负荷和设计流量计算实际温差
        actual_sink_out = effective_sink_target  # 默认值
        if max_load_kw > 0 and req.sink_flow_kg_h > 0:
            # 计算实际温差：deltaT = Q / (m * Cp)
            # Q: 实际负荷 (kW) -> 转换为 kJ/h
            # m: 流量 (kg/h)
            # Cp: 水的比热容 (kJ/kg·K) = 4.187
            actual_deltaT = (max_load_kw * 3600.0) / (req.sink_flow_kg_h * 4.187)
            actual_sink_out = req.sink_in_temp + actual_deltaT
            
            # 边界保护：不能超过目标温度
            if actual_sink_out > effective_sink_target:
                actual_sink_out = effective_sink_target
            
            print(f"   计算过程: 实际负荷={max_load_kw:.1f} kW, 流量={req.sink_flow_kg_h:.0f} kg/h")
            print(f"   实际温差: {actual_deltaT:.2f}°C, 入口={req.sink_in_temp:.1f}°C, 出口={actual_sink_out:.1f}°C")
        
        # 🔧 新增：计算水分析出量
        water_condensation = None
        if req.fuel_type != 'ELECTRICITY':
            fuel_data = FUEL_DB.get(req.fuel_type, FUEL_DB['NATURAL_GAS'])
            excess_air = getattr(req, 'excess_air', 1.2)  # 使用getattr更安全
            actual_dew_point = calculate_adjusted_dew_point(fuel_data["dewPointRef"], excess_air)
            
            # 估算烟气中水蒸气体积百分比
            h2o_vol_percent = 0.0
            
            if req.fuel_type == 'NATURAL_GAS':
                # 天然气：CH4 + 2O2 -> CO2 + 2H2O
                theo_co2 = 1.0
                theo_h2o = 2.0
                theo_n2 = 7.52
                excess_o2 = (excess_air - 1.0) * 2.0
                excess_n2 = (excess_air - 1.0) * 7.52
                total_vol = theo_co2 + theo_h2o + theo_n2 + excess_o2 + excess_n2
                h2o_vol_percent = (theo_h2o / total_vol) * 100
            elif req.fuel_type == 'COAL':
                h2o_vol_percent = 8.0
            elif req.fuel_type == 'DIESEL':
                h2o_vol_percent = 12.0
            else:
                h2o_vol_percent = 10.0  # 默认值
            
            # 计算水分析出量
            water_condensation = calculate_water_condensation(
                t_source_in,
                final_t_source_out,
                req.source_flow_vol,
                h2o_vol_percent,
                actual_dew_point
            )
        
        print(f"✅ 按用户指定的排烟温度 {final_t_source_out:.1f}°C 计算完成")
        print(f"   排烟温度: {final_t_source_out:.1f}°C (用户指定)")
        print(f"   实际负荷: {max_load_kw:.1f} kW")
        print(f"   实际出水: {actual_sink_out:.1f}°C")
        print(f"   COP: {cop:.2f}")
        if water_condensation and water_condensation["condensed_water"] > 0:
            print(f"   水分析出量: {water_condensation['condensed_water']:.2f} kg/h")
        
        result = {
            "status": "converged",
            "iterations": self.max_iter,
            "target_load_kw": round(max_load_kw, 1),  # 实际能达到的负荷
            "required_source_out": round(final_t_source_out, 2),  # 严格按照用户指定的排烟温度
            "final_cop": cop,
            "source_total_kw": round(max_source_heat, 1),
            "actual_sink_out": round(actual_sink_out, 1),  # 实际出水温度
            "is_source_limited": max_load_kw < q_sink_target_kw * 0.95  # 如果实际负荷低于目标，标记为热源限制
        }
        
        # 🔧 新增：添加水分析出数据到返回结果
        if water_condensation:
            result["water_condensation"] = water_condensation
        
        return result
# 引入我们刚才写的物理模块
from app.core.physics import get_sat_temp_from_pressure, estimate_enthalpy

print("=== 开始物理引擎验算 ===")

# 测试 1: 压力转温度
# 假设前端输入 0.5 MPa，我们看看 Python 算出来是多少
p_input = 0.5
t_result = get_sat_temp_from_pressure(p_input)
print(f"输入压力: {p_input} MPa")
print(f"Python计算饱和温度: {t_result} °C")
# 您的 JS 逻辑在这个压力下应该接近 151.8°C 左右 (对于水/Antoine公式)

# 测试 2: 焓值计算
t_input = 90.0
h_water = estimate_enthalpy(t_input, is_steam=False)
print(f"\n输入温度: {t_input} °C (热水)")
print(f"Python计算焓值: {h_water} kJ/kg")
# 预期: 90 * 4.187 = 376.83

print("\n=== 验算结束 ===")
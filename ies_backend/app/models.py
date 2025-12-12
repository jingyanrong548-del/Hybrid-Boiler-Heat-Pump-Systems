# app/models.py
from pydantic import BaseModel

# 定义前端发过来的数据格式
class StandardCalcRequest(BaseModel):
    source_temp: float      # 热源进水温度
    target_temp: float      # 目标出水温度
    efficiency: float = 0.55 # 完善度，默认 0.55
    mode: str = "WATER"     # WATER 或 STEAM
    strategy: str = "STRATEGY_PRE"
    # === 新增：方案C 的输入数据格式 ===
class SchemeCRequest(BaseModel):
    sink_in_temp: float      # 补水温度 (e.g. 20)
    sink_out_target: float   # 目标水温 (e.g. 90)
    sink_flow_kg_h: float    # 水流量 (e.g. 50000 kg/h)
    
    source_in_temp: float    # 烟气进口温度 (e.g. 130)
    source_out_target: float = 30.0  # 🔧 新增：用户输入的目标排烟温度 (e.g. 80)
    source_flow_vol: float   # 烟气流量 (e.g. 30000 m3/h)
    
    efficiency: float = 0.55 # 完善度
    mode: str = "WATER"      # WATER 或 STEAM
    strategy: str = "STRATEGY_PRE"  # 🔧 新增：蒸汽策略 STRATEGY_PRE 或 STRATEGY_GEN
    fuel_type: str = "NATURAL_GAS" # 燃料类型(影响比热容)
    recovery_type: str = "MVR"  # 🔧 新增：热泵类型 MVR 或 ABSORPTION_HP
    
    # 🔧 新增：手动COP锁定支持
    is_manual_cop: bool = False  # 是否启用手动COP锁定
    manual_cop: float = 3.5      # 手动COP值
    
    # 🔧 新增：过量空气系数（用于计算水分析出）
    excess_air: float = 1.2       # 过量空气系数，默认1.2
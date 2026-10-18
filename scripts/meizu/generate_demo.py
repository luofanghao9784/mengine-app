#!/usr/bin/env python3
"""Deterministic synthetic rental data; never represents actual Meizu operations."""
from pathlib import Path
import json, hashlib, datetime
root=Path(__file__).resolve().parents[2]
out=root/'.local/meizu-production/materials';out.mkdir(parents=True,exist_ok=True)
manifest_path=out.parent/'materials-manifest.json'
if manifest_path.exists():
 raise SystemExit('已有演示清单；为保留上传幂等标识和正式回执，拒绝覆盖。')
manifest=[]
def doc(space,title,text):
 p=out/(title+'.md');p.write_text('# '+title+'\n\n> 合成演示数据；项目、人员、租客、交易、制度及事件均为虚构，不代表贵州美租实际经营。统计截止：2026-09-30。金额单位：元。\n\n'+text+'\n')
 manifest.append({'space':space,'filename':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'requestId':None})
def table(rows):
 keys=list(rows[0]);return '| '+' | '.join(keys)+' |\n| '+' | '.join(['---']*len(keys))+' |\n'+'\n'.join('| '+' | '.join(str(r[k]) for k in keys)+' |' for r in rows)
rooms=[];contracts=[];bills=[];payments=[]
for i in range(1,101):
 project='云栖演示公寓' if i<=60 else '观澜演示公寓';rid=f'MZ-R{i:03}'
 active=i<=42 or 61<=i<=94
 rooms.append({'房源ID':rid,'项目':project,'套数':1,'2026-09-30状态':'在租' if active else '维修停租' if 49<=i<=60 else '可租空置','标价':1000+(i%5)*100,'数据属性':'合成'})
 if i<=46 or 61<=i<=94:
  start='2026-07-01' if i<=46 or i<=82 else '2026-08-01' if i<=88 else '2026-09-01'
  end='2026-08-31' if 43<=i<=46 else '2026-10-31' if i<=8 else '2027-06-30'
  cid=f'MZ-C{i:03}';rent=1000+(i%5)*100
  contracts.append({'合同ID':cid,'房源ID':rid,'租客代号':f'演示租客{i:03}','起租日':start,'终止日':end,'月租':rent,'押金':rent,'截止状态':'已退租' if 43<=i<=46 else '在租','数据属性':'合成'})
  for m in [7,8,9]:
   day=f'2026-{m:02}-01'
   if start<=day<=end:
    bid=f'MZ-B{m:02}-{i:03}';paid=0 if m==9 and i<=6 else rent//2 if m==9 and 7<=i<=10 else rent
    bills.append({'账单ID':bid,'合同ID':cid,'项目':project,'账期':f'2026-{m:02}','应付日':f'2026-{m:02}-05','租金应收':rent,'已分配实收':paid,'未收余额':rent-paid,'数据属性':'合成'})
    if paid:payments.append({'收款ID':f'MZ-P{m:02}-{i:03}','账单ID':bid,'收款日期':f'2026-{m:02}-04','租金实收':paid,'用途':'当期租金','数据属性':'合成'})
assert len({r['房源ID'] for r in rooms})==100
assert sum(r['已分配实收'] for r in bills)==sum(r['租金实收'] for r in payments)
assert all(r['租金应收']==r['已分配实收']+r['未收余额'] for r in bills)
assert all(p['账单ID'] in {b['账单ID'] for b in bills} for p in payments)
for title,space,rows in [('01-房源状态台账','招租运营',rooms),('02-租约与到期清单','租务与客户服务',contracts),('03-租金应收台账','财务收缴',bills),('04-租金收款流水','财务收缴',payments)]:doc(space,title,table(rows))
monthly=[]
for m in [7,8,9]:
 for project,total in [('云栖演示公寓',60),('观澜演示公寓',40)]:
  rr=[b for b in bills if b['账期']==f'2026-{m:02}' and b['项目']==project]
  monthly.append({'月份':f'2026-{m:02}','项目':project,'管理房源':total,'月末在租':len(rr),'出租率':f'{len(rr)/total:.1%}','当期应收':sum(x['租金应收'] for x in rr),'截至期末实收':sum(x['已分配实收'] for x in rr),'未收余额':sum(x['未收余额'] for x in rr)})
doc('经营管理','05-三个月经营汇总',table(monthly)+'\n\n出租率按月末在租套数/管理总套数计算；维修停租房源仍在分母。收款只包含这些账单对应的当期租金，不包括押金、历史欠款、代收费和管理费，不等同企业收入或利润。')
leads=[]
for i in range(1,121):
 ch=['平台自然流量','短视频投放','老客转介绍'][(i-1)//40];j=(i-1)%40
 leads.append({'线索ID':f'MZ-L{i:03}','登记日':f'2026-09-{i%28+1:02}','渠道':ch,'项目':'观澜演示公寓' if i%2 else '云栖演示公寓','已带看':'是' if j< [24,30,16][(i-1)//40] else '否','结果':'待决策' if j<10 else '预算不符' if j<20 else '跟进中','数据属性':'合成'})
doc('招租运营','06-九月渠道咨询与带看',table(leads)+'\n\n线索表是独立漏斗观察样本，未建立签约归因，不据此声称渠道成交或计算获客成交成本。')
work=[{'工单ID':f'MZ-W{i:03}','房源ID':f'MZ-R{i:03}','报修日':'2026-08-25','故障':'漏水检修' if i%2 else '空调更换','计划验收日':'2026-09-15','截至9月30日状态':'待验收' if i<=54 else '待配件','预计维修费':500+(i%3)*200,'数据属性':'合成'} for i in range(49,61)]
doc('工程与采购','07-维修停租与工单',table(work)+'\n\n12 套均未完成验收，暂不恢复可租；费用是预算，不是已支付成本。')
doc('租务与客户服务','08-退租回访与续租行动','8 月底 MZ-C043 至 MZ-C046 四份合同终止，合成回访原因分别为工作调动、合租调整、通勤变化、预算调整。不能由此推断真实企业服务质量。\n\nMZ-C001 至 MZ-C008 将于 10 月 31 日到期，先核对租客意向，再形成续租草稿；不自动发送消息、不承诺减租。')
doc('经营管理','09-运营例会纪要与行动草稿','演示会议日期：2026-09-30。参与角色：运营负责人、租务负责人、维修负责人、财务负责人，均为虚构角色。\n\n云栖在租从 46 套降至 42 套，直接变化为四份租约终止；12 套维修停租限制后续可供给量，不能把维修与全部退租作因果等同。观澜从 22 套增至 34 套。\n\n行动草稿：维修负责人于 10 月 8 日补齐验收安排；租务负责人于 10 月 10 日完成八份到期合同回访；财务逐笔核对九月未收账单。行动均为演示计划，未实际执行。')
doc('财务收缴','10-指标口径与核对规则','统计窗口：2026-07-01 至 2026-09-30，各账期只计一次应收。账单 ID 关联收款，余额=应收-已分配实收。应付日早于统计截止且余额大于零才为逾期。押金仅在合同列示，不纳入租金回款。\n\n无业主分账、管理费率、税费、装修折旧及完整成本资料，不能计算集团营收、利润或可分配资金。不同经营模式不能将代收租金视为运营商自有收入。')
doc('项目筹备','11-新项目接管清单草稿','虚构筹备对象：云栖演示二期，计划新增 20 套，未交付、未纳入管理房源总量。\n\n|事项|状态|验收依据|\n|---|---|---|\n|房源权属资料核对|待补充|授权文件草稿|\n|家具家电清单|待核对|逐房设备清单|\n|维修验收|未完成|验收记录|\n|招租内容|草稿|运营确认|\n|可租开放日期|未确定|前三项完成后另行确认|')
doc('经营管理','12-企业背景与演示边界','企业名称由用户提供：贵州美租企业管理集团有限公司。公开报道中存在贵州美租集团、美寓租行家住房运营线索，但准确工商关系尚未独立核实。\n\n本套样例中的两处公寓、100 套房源、金额、合同和人员全部合成，不是公开报道的金阳/艳山红项目，也不代表集团规模。六个空间属于演示设计，不代表企业真实部门。\n\n公开背景来源（仅供核对，非内部经营依据）：https://www.haofangdp.com/fjdpbj/newslist/reviewconsultation?itemId=7498185497438254386\n\n建议演示：对比三个月出租率；逐笔核对九月逾期；关联维修房源与工单；整理八份到期合同；生成经营复盘草稿并由人核对。')
(out.parent/'materials-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
summary={'rooms':len(rooms),'contracts':len(contracts),'bills':len(bills),'payments':len(payments),'leads':len(leads),'workOrders':len(work),'materials':len(manifest),'rentDue':sum(x['租金应收'] for x in bills),'rentPaid':sum(x['已分配实收'] for x in bills),'balance':sum(x['未收余额'] for x in bills)}
(out.parent/'data-verification.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n');print(json.dumps(summary,ensure_ascii=False))

"""Author 20 explicitly synthetic, Codex-curated cards. No model/API calls.
Outputs a private manifest for a guarded importer; never marks a live model run.
"""
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP
import json, uuid, hashlib, datetime
root=Path(__file__).resolve().parents[2]/'.local/meizu-production'
materials=json.loads((root/'materials-manifest.json').read_text())
ns=uuid.UUID('9093e4a0-959e-4ef8-88fe-13276744941e')
def uid(key):return str(uuid.uuid5(ns,'codex-curated-20-v2:'+key+(':copyedit' if key.startswith('18:') else '')))
def dec(v):return str(Decimal(str(v)).quantize(Decimal('.0001'),rounding=ROUND_HALF_UP)).rstrip('0').rstrip('.') if '.' in str(Decimal(str(v)).quantize(Decimal('.0001'))) else str(v)
def row(group,a,b):
 a,b=Decimal(str(a)),Decimal(str(b));return dict(group=group,baseline=dec(a),current=dec(b),difference=dec(b-a),changePercent=dec((b-a)/a*100) if a>0 else None,baselineRank=None,currentRank=None,issue=None if a>0 else 'NON_POSITIVE_BASELINE')
def chart(metric,unit,baseline,current,rows,total=None):
 r=[row(*x) for x in rows]
 if total is None:total=(sum(Decimal(x['baseline']) for x in r),sum(Decimal(x['current']) for x in r))
 return dict(type='GROUPED_BAR',metric=metric,unit=unit,baseline=baseline,current=current,range='合成演示 · 2026年第三季度',rows=r,totals=row(None,*total))
cards=[]
def add(kind,title,summary,analysis,source,size='STANDARD',layout='EDITORIAL',style=None,ch=None,focus=None,roles=None):
 i=len(cards)+1;m=next(m for m in materials if m['filename'].startswith(f'{source:02}-'));chunks=m['analysis']['chunks'];chunk=next((c for c in chunks if not c['content'].startswith('#') and '合成' not in c['content'][:20]),chunks[0]);v=m['receipt']['acceptedVersion'];
 content=dict(schemaVersion='briefing-data-v1' if ch else 'briefing-text-v1',businessType=kind,title=title+'｜演示',summary='合成演示，截至2026年9月30日。'+summary,analysis=analysis,chart=ch,source=dict(id=chunk['id'],materialId=m['receipt']['id'],versionId=v['id'],version=1,filename=m['filename'],sha256=m['sha256'],scopeExcerpt=chunk['content']),calculationArtifactId=uid(f'{i}:calculation') if ch else None,calculationSha256=None,generatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),datasetSource=None,datasetBasis=None,presentation=dict(version='briefing-presentation-v1',layout=layout,chartStyle=style,focusGroup=None,focusValue=focus,sections=[dict(role=r,paragraphIndex=n) for n,r in enumerate(roles or ['OBSERVATION']*len(analysis))]))
 calc=None
 if ch:
  calc=dict(recipeVersion='codex-demo-arithmetic-1',author='Codex',synthetic=True,sourceSha256=m['sha256'],chart=ch,scope='由合成底表核对后计算；不是梦擎模型或其表格工具执行。')
  content['calculationSha256']=hashlib.sha256(json.dumps(calc,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
 cards.append(dict(index=i,conversationId=uid(f'{i}:conversation'),taskId=uid(f'{i}:task'),attemptId=uid(f'{i}:import'),artifactId=uid(f'{i}:artifact'),workspaceId=m['receipt']['workspaceId'],workspace=m['space'],size=size,content=content,calculation=calc))
add('DATA','在租增加8套，增长来自观澜','三个月内在租房源从68套增至76套，两个项目方向不同。',['云栖从46套降至42套，减少4套；观澜从22套增至34套，增加12套。合计在租增加8套。','云栖7月与8月持平，只在9月下降；不能表述为连续两月下滑，也不能据此认定观澜某项营销策略有效。'],5,'WIDE',style='GROUPED_BAR',ch=chart('月末在租','套','7月','9月',[('云栖',46,42),('观澜',22,34)]))
add('DATA','九月应收增加2600元','观澜的增加抵消了云栖的下降，应收不是集团营业收入。',['云栖应收由8月55100元降至9月50300元，减少4800元；观澜由33600元增至41000元，增加7400元。','合计应收由88700元增至91300元，净增2600元；该口径仅覆盖合成租金账单，不包含押金和管理费。'],5,'WIDE',style='DELTA_BAR',ch=chart('月租金应收','元','8月','9月',[('云栖',55100,50300),('观澜',33600,41000)]))
add('DATA','9550元，先分清未收构成','六笔零回款和四笔部分回款，应分别核对。',['六笔零回款账单合计未收7100元；四笔部分回款账单合计未收2450元，两类合计9550元。','所有未收均在云栖演示公寓。未收是账单余额，不能等同企业亏损，也不说明租客的主观付款意愿。'],15,layout='KEY_METRIC',style='CURRENT_BAR',ch=chart('九月未收余额','元','起点','9月末',[('零回款',0,7100),('部分回款',0,2450)]),focus='CURRENT')
add('DATA','九月收缴，一张表核到底','应收91300元、实收81750元，差额9550元。',['云栖应收50300元、实收40750元；观澜应收与实收均为41000元。表中差额为实收减应收。','先按账单ID核对收款分配，再解释余额。不要把未匹配到账的收款与确实未付款混在一起。'],15,'WIDE',style='TABLE',ch=chart('九月租金收缴','元','应收','实收',[('云栖',50300,40750),('观澜',41000,41000)]))
add('DATA','100套房源，三种经营状态','76套在租、12套可租空置、12套维修停租。',['房源状态互斥且合计100套。维修停租房源暂不可供给，可租空置房源则可以进入带看与签约流程。','判断库存压力时应分别查看可租空置和维修停租；两类措施不同，不能用一个空置指标代替。'],1,style='CURRENT_BAR',ch=chart('房源状态','套','起点','9月末',[('在租',0,76),('可租空置',0,12),('维修停租',0,12)]))
add('DATA','出租率分化，不等于能力定论','云栖从76.7%降到70.0%，观澜从55.0%升到85.0%。',['项目出租率以月末在租套数除以管理房源数计算。云栖分母60套、观澜40套，分母均未变化。','图中合计按100套房源加权计算为68%与76%，不是两个项目出租率的简单平均；差异尚需结合到期和供给变化解释。'],13,'WIDE',style='DUMBBELL',ch=chart('月末出租率','%','7月','9月',[('云栖',Decimal(46)/60*100,70),('观澜',55,85)],(68,76)))
add('DATA','12个维修工单，两条推进线','6条待验收与6条待配件，当前均未恢复可租。',['待验收工单为MZ-W049至054；待配件为MZ-W055至060。两组各6条，合计对应12套维修停租房源。','这张图呈现状态数量，不是完成率。实际复租需待检查、验收与房态更新完成后确认。'],14,style='CURRENT_BAR',ch=chart('维修工单','条','起点','9月末',[('待验收',0,6),('待配件',0,6)]))
add('DATA','总体出租率达到76%','比7月提高8个百分点，但仍有24套不在租。',['7月在租68套，9月在租76套，管理房源总数为100套；总体出租率从68%升至76%。','其中12套可租空置、12套维修停租。后续动作应分别对应招租转化和维修验收，不能预设这些房源都会在同一天出租。'],13,layout='KEY_METRIC',style='GROUPED_BAR',ch=chart('总体出租率','%','7月','9月',[('全部房源',68,76)]),focus='CURRENT')
add('INSIGHT','云栖回落：先拆开退租与维修','四份租约终止解释在租下降，维修限制后续供给。',['MZ-C043至046在8月底终止，云栖在租由46套降至42套，数量对应。','12套维修停租属于另一组房源，限制可供给量，但不能据此认定它们导致四户退租。','复盘应分别查看到期回访和维修进度；在证据不足时，保留原因判断。'],9,roles=['OBSERVATION','INTERPRETATION','CAUTION'])
add('INSIGHT','招租提速还是修好再租','两条路径都有价值，取决于房源是否具备出租条件。',['方案一：对可租空置房源，优先核对展示信息、带看安排和签约障碍，避免对不具备条件的房源承诺入住。','方案二：对维修停租房源，先处理配件、施工和验收，再更新可租状态；不得用带看数量替代修复完成。','两条路径可以并行，但对外报价和入住承诺应以房态核验为前提。'],1,'WIDE','COMPARISON',roles=['OPTION','OPTION','CAUTION'])
add('INSIGHT','回款缺口不是利润缺口','租金、押金、管理费和成本属于不同口径。',['本套数据中的收款仅指账单对应租金；押金在合同列示但不计入租金回款。','没有业主分账、管理费率、税费及完整成本，不能据此计算企业营业收入、利润或可分配资金。'],10,roles=['OBSERVATION','CAUTION'])
add('SUGGESTION','先验收，再恢复可租','把六条待验收工单拆成可检查的行动。',['第一步：按MZ-W049至054逐条核对维修范围与现场照片，确认验收责任人和检查安排。','第二步：核验漏水或空调故障是否解决，留存检查结论；不通过的工单继续停租并记录问题。','第三步：验收通过后更新房态，再安排带看。本卡是行动建议，未代替现场验收。'],14,layout='STEPS',roles=['ACTION','ACTION','CAUTION'])
add('SUGGESTION','催收之前，先把账核清','零回款和部分回款分组跟进，避免误催。',['第一步：按账单ID核对收款归属、到账日期和分配金额，排查已付款但尚未匹配的情形。','第二步：对六笔零回款核对付款状态，对四笔部分回款核对剩余金额与双方约定，记录可验证的原因。','第三步：由人工确认沟通对象与话术后再联系。本次只形成建议，不发送任何消息。'],15,'WIDE','STEPS',roles=['ACTION','ACTION','CAUTION'])
add('SUGGESTION','八份到期租约，提前做选择','10月31日到期的合同先回访，再安排续租或退租。',['续租路径：对MZ-C001至008核对租客意向和现有约定，再形成报价草稿；未获确认不承诺减租。','退租路径：确认退租日期、房屋检查和费用核对事项，为后续招租留出准备时间。','两种路径均需人工确认；目前八份合同只是到期清单，不代表已经续租或已经退租。'],8,'WIDE','COMPARISON',roles=['OPTION','OPTION','CAUTION'])
add('SUGGESTION','20套筹备房源，不急着并表','接管清单先完成，经营台账再扩展。',['先核对资料移交、房屋检查、钥匙与设备清点，明确20套筹备房源的接管条件。','再确认可租日期、定价和服务安排，满足条件后建立正式房源记录。','筹备房源未计入当前100套；未完成接管前不纳入出租率分母，也不预记租金收入。'],11,layout='STEPS',roles=['ACTION','ACTION','CAUTION'])
add('INFO','出租率的分母，不能随意缩小','维修停租房源仍计入管理房源总数。',['本套口径以月末在租套数除以全部管理房源数，当前管理房源共100套。','12套维修停租仍留在分母；若临时剔除，会人为抬高出租率，破坏各月可比性。本卡为演示口径说明，不是外部新闻。'],5,layout='SOURCE',roles=['OBSERVATION','CAUTION'])
add('INFO','看报表，先看统计截止日','九月末快照不是今天的实时经营状态。',['所有底表均为截至2026年9月30日的合成演示数据，生成日期不改变它们的统计期间。','过期的维修计划、租约和收款信息需要重新核验后才可用于当前决策；本卡为演示知识说明，不包含实时行业资讯。'],12,layout='SOURCE',roles=['OBSERVATION','CAUTION'])
add('RESULT','运营复盘提纲，已整理成稿','可用于运营会议，结论和行动仍需人工确认。',['议题一：展示两项目出租率变化，区分云栖到期退出与维修供给问题，不推断未验证的原因。','议题二：核对九月9550元未收余额，分别讨论零回款和部分回款的核对动作。','议题三：检查12条维修工单与8份到期租约，形成责任人和计划日期的待确认清单。这里的成果是提纲，不代表会议已召开。'],9,'WIDE',roles=['OBSERVATION','OBSERVATION','CAUTION'])
add('RESULT','续租回访话术，备好三问','一份可审核的沟通草稿，不自动对外发送。',['开场草稿：您好，我们准备核对您当前租约的到期安排，请问您是否方便确认一下后续居住计划？','问题清单：是否考虑续住？目前有哪些需要处理的居住问题？如计划搬离，希望何时办理交接？','结束草稿：感谢反馈，我们核对合同和服务安排后再与您确认。具体金额和日期以双方最终确认内容为准。'],8,layout='SOURCE',roles=['OBSERVATION','OBSERVATION','CAUTION'])
add('RESULT','接管检查清单，进入评审','筹备项目的交接材料已按检查环节整理。',['资料清点：核对房源清单、合同资料、设备记录及移交边界，缺失项单独登记。','现场检查：记录钥匙、设备和房屋状况，区分可直接出租、需维修和待确认项目。','评审结论：仅在接管条件、责任人和对外承诺确认后推进。本卡交付的是检查清单草稿，不是接管完成证明。'],11,'WIDE',layout='SOURCE',roles=['OBSERVATION','OBSERVATION','CAUTION'])
for card in cards:
 content=card['content']
 content['title']=content['title'].replace('｜演示','')
 content['summary']=content['summary'].replace('合成演示，截至2026年9月30日。','截至2026年9月30日。')
 content['analysis']=[p.replace('合成租金账单','租金账单').replace('云栖演示公寓','云栖公寓').replace('本卡为演示口径说明，不是外部新闻。','此口径用于保持各月可比性。').replace('所有底表均为截至2026年9月30日的合成演示数据','本批资料统计截至2026年9月30日').replace('本卡为演示知识说明，不包含实时行业资讯。','应先更新数据，再作当前判断。') for p in content['analysis']]
 if card['index']==17:content['presentation']['layout']='EDITORIAL'
 if content['chart']:
  content['chart']['range']='2026年第三季度'
  card['calculation']['chart']=content['chart']
  content['calculationSha256']=hashlib.sha256(json.dumps(card['calculation'],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
assert len(cards)==20
for c in cards:
 x=c['content'];assert 4<=len(x['title'])<=80 and 12<=len(x['summary'])<=240 and all(12<=len(a)<=500 for a in x['analysis'])
 if c['calculation']:
  for r in x['chart']['rows']:assert Decimal(r['current'])-Decimal(r['baseline'])==Decimal(r['difference'])
(root/'curated-20.json').write_text(json.dumps(cards,ensure_ascii=False,indent=2))
print(json.dumps({'cards':len(cards),'types':{t:sum(c['content']['businessType']==t for c in cards) for t in ['DATA','INSIGHT','SUGGESTION','INFO','RESULT']},'chartStyles':sorted(set(c['content']['presentation']['chartStyle'] for c in cards if c['calculation'])),'sizes':{s:sum(c['size']==s for c in cards) for s in ['STANDARD','WIDE']}},ensure_ascii=False))

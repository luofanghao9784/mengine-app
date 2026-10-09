"""Reviewed fixed business projections. No SQL, table or column input from a caller."""

DEFINITIONS = {}
DESCRIPTIONS = {}


def dataset(key, name, table, fields, reading, where='', order='id'):
    pairs = [item.split('=', 1) for item in fields.split()]
    DEFINITIONS['ninepop_' + key + '_v1'] = (
        name, '负责人专属', [label for _, label in pairs],
        'SELECT ' + ','.join(column for column, _ in pairs) + ' FROM ' + table
        + (' WHERE ' + where if where else '') + ' ORDER BY ' + order)
    DESCRIPTIONS['ninepop_' + key + '_v1'] = (
        reading + '；只读固定快照，金额单位分，比率基点；空值保留为空，禁止按零推断。'
        '保留原状态，档案数不等于有效业务数。来源关联按ID核对，不能重复汇总。')


dataset('finance_accounts', '财务核算主体', 'finance_accounts',
        'id=核算主体ID account_code=主体编码 account_name=主体名称 account_type=主体类型 store_id=门店ID status=状态 opened_at=启用时间 closed_at=关闭时间 updated_at=更新时间',
        '总部与门店核算主体目录，不是银行实时余额')
dataset('payment_accounts', '财务支付账户目录', 'finance_payment_accounts',
        'id=支付账户ID code=账户编码 name=账户名称 finance_account_id=核算主体ID account_kind=账户类型 status=状态 current_holder_account_id=持有人账号ID updated_at=更新时间',
        '仅业务账户目录，不含银行卡号、支付凭据或密钥')
dataset('ledger', '财务资金流水', 'finance_ledger_entries',
        'id=流水ID account_id=核算主体ID payment_account_id=支付账户ID business_store_id=业务门店ID source_store_id=来源门店ID direction=收支方向 entry_type=业务类型 amount_cents=金额（分） book_status=账务状态 cash_status=现金状态 occurred_at=发生时间 accounting_period=核算期间 source_type=来源类型 source_id=来源业务ID source_action=来源动作 source_version=来源版本 transfer_group_id=内部划转组ID reversal_of_entry_id=原流水ID created_at=创建时间 updated_at=更新时间',
        'effective已生效、projected待入账、voided作废；not_cash不计现金收支；内部划转/冲销/分红不得当营业收入费用重复累计；实际银行余额须另查对账')
dataset('petty_cash', '备用金流水', 'finance_petty_cash_entries',
        'id=备用金流水ID payment_account_id=支付账户ID business_store_id=业务门店ID business_ledger_entry_id=业务流水ID movement_type=变动类型 direction=增减方向 amount_cents=金额（分） book_status=账务状态 occurred_at=发生时间 accounting_period=核算期间 reversal_of_entry_id=原备用金流水ID source_type=来源类型 source_id=来源业务ID updated_at=更新时间',
        'increase增加、decrease减少；业务流水与备用金流水可能是同一支出的两个维度，禁止相加；生效余额与待入账分列')
dataset('positions', '财务往来款项', 'finance_positions',
        'id=往来ID finance_account_id=核算主体ID business_store_id=业务门店ID position_type=往来类型 position_side=债权债务方向 original_amount_cents=原始金额（分） outstanding_amount_cents=未结金额（分） pending_settlement_amount_cents=待结金额（分） currency=币种 opened_on=建立日期 due_on=到期日期 status=状态 version=版本 updated_at=更新时间',
        '债权债务余额独立于现金和收入费用；未导出对方账户信息')
dataset('position_events', '财务往来变动', 'finance_position_events',
        'id=往来事件ID position_id=往来ID event_type=事件类型 effect_direction=变动方向 settlement_mode=结算方式 amount_cents=金额（分） book_status=账务状态 occurred_at=发生时间 accounting_period=核算期间 approval_id=审批ID ledger_entry_id=资金流水ID reversal_of_event_id=原事件ID updated_at=更新时间',
        '按往来ID及资金流水关联核对，不与资金流水重复计算')
dataset('payroll_reserves', '工资资金预留', 'finance_store_payroll_reserves',
        'id=预留ID store_id=门店ID payroll_period=工资月份 payable_amount_cents=预留应付（分） source_type=来源类型 locked=锁定 version=版本 updated_at=更新时间',
        '资金预留不是工资支付，也不是新增费用')
dataset('rent_cycles', '租金周期与付款计划', 'finance_store_rent_cycles',
        'id=租金周期ID rent_plan_id=租金计划ID store_id=门店ID cycle_start_month=开始月份 cycle_end_month=结束月份 due_date=到期日 monthly_rent_cents=月租金（分） covered_months=覆盖月数 total_rent_cents=周期租金（分） opening_paid_cents=期初已付（分） status=状态 paid_at=付款时间 superseded_at=替代时间 updated_at=更新时间',
        '租金计划与实际费用流水分别表达；被替代周期不重复累计')
dataset('reconciliation_batches', '财务对账批次', 'finance_reconciliation_batches',
        'id=对账批次ID batch_no=批次编号 status=状态 close_result=关闭结果 cutoff_at=截止时间 baseline_batch_id=基线批次ID correction_of_batch_id=更正原批次ID revision_no=修订号 is_baseline=是否基线 closed_at=关闭时间 updated_at=更新时间',
        '按已完成批次及更正关系读取，多个时点余额不能相加')
dataset('reconciliation_balances', '财务对账账户余额', 'finance_reconciliation_account_balances',
        'id=余额记录ID batch_id=对账批次ID reconciliation_account_id=对账账户ID finance_account_id=核算主体ID account_type=账户类型 balance_bucket=余额类别 amount_cents=余额（分） updated_at=更新时间',
        '仅对账截止时点的实际余额，不是当前实时银行余额；须关联对账批次')
dataset('reconciliation_subjects', '财务对账主体差异', 'finance_reconciliation_subject_snapshots',
        'id=主体快照ID batch_id=对账批次ID subject_key=主体标识 finance_account_id=核算主体ID confirmed_system_net_cents=已确认系统净额（分） projected_net_cents=预计净额（分） position_net_cents=往来净额（分） t0_actual_cents=基线实际金额（分） post_t0_system_change_cents=基线后变动（分） expected_account_total_cents=预期账户总额（分） actual_account_total_cents=实际账户总额（分） liquid_cents=流动余额（分） unsettled_cents=未结算（分） petty_cash_cents=备用金（分） opening_baseline_difference_cents=期初差额（分） variance_cents=差异（分） updated_at=更新时间',
        '系统参考、真实账户与差异分别展示，必须固定批次')
dataset('historical_reconciliation', '历史财务对账参考', 'finance_reconciliation_historical_summaries',
        'id=历史参考ID reference_no=参考编号 cutoff_at=截止时点 liquid_cents=流动余额（分） unsettled_cents=未结算（分） petty_cash_cents=备用金（分） actual_account_total_cents=实际总额（分） system_reference_cents=系统参考（分） difference_cents=差额（分） known_unposted_cents=已知未入账（分） unexplained_cents=未解释差额（分） created_at=创建时间',
        '不可变历史参考，不作为现在余额，不与正常对账批次累加')
dataset('payslips', '工资条与分项应付', 'payslips',
        'id=工资条ID coach_id=教练ID store_id=门店ID period_month=工资月份 version=版本 status=状态 locked=锁定 confirmed_at=确认时间 session_fee_cents=课时费（分） trial_course_commission_cents=体验课提成（分） personal_sales_amount_cents=个人销售额（分） personal_commissionable_revenue_cents=个人可提成收入（分） personal_sales_commission_cents=个人销售提成（分） manager_store_commission_cents=店长提成（分） manager_position_salary_cents=店长岗位工资（分） guarantee_topup_cents=保底补差（分） founder_average_deduction_cents=创始人均薪扣减（分） refund_deduction_cents=退款扣减（分） income_tax_withheld_cents=代扣税（分） manual_adjustment_cents=人工调整（分） actual_payable_cents=应付工资（分） commission_snapshot_complete=提成快照完整 commission_algorithm_version=提成算法版本 updated_at=更新时间',
        'confirmed为工资条确认，不代表已付款；actual_payable为应付，真实付款须关联salary_payout资金流水；不得将个人销售额当门店总收入')
dataset('payslip_adjustments', '工资调整项目', 'payslip_adjustments',
        'id=调整ID payslip_id=工资条ID type=调整类型 amount_cents=调整金额（分） created_at=创建时间 updated_at=更新时间',
        '调整已反映在对应工资条，不能再重复加总；不采集自由文本原因')
dataset('dividend_participants', '分红参与主体', 'dividend_participants',
        'id=参与人ID store_id=门店ID participant_type=参与人类型 display_name=参与人名称 finance_account_id=核算主体ID coach_id=教练ID member_id=会员ID effective_from_month=开始月份 effective_to_month=结束月份 eligible=有资格 version=版本 updated_at=更新时间',
        '分红归属与有效月份依据，仅负责人可读')
dataset('dividend_periods', '门店分红期间', 'dividend_periods',
        'id=分红期间ID store_id=门店ID accounting_period=核算月份 status=状态 basis_version=依据版本 cash_profit_cents=现金利润口径（分） subsidy_addback_cents=补贴加回（分） distributable_basis_cents=可分配依据（分） risk_mode_snapshot=风险模式 policy_version_snapshot=政策版本 ratio_source=比例来源 ratio_confirmed_at=比例确认时间 locked_at=锁定时间 version=版本 updated_at=更新时间',
        'draft草稿与locked锁定分开；分配依据不等于实付或银行余额；不得跨版本叠加')
dataset('dividend_ratios', '分红期间比例', 'dividend_ratio_lines',
        'id=比例ID dividend_period_id=分红期间ID participant_id=参与人ID ratio_bps=比例（基点） created_at=创建时间',
        '10000基点等于100%，按所属期间关联，不外推到其他月份')
dataset('dividend_events', '分红权益事件', 'dividend_entitlement_events',
        'id=权益事件ID store_id=门店ID participant_id=参与人ID accounting_period=核算月份 event_type=事件类型 amount_cents=权益金额（分） original_event_id=原事件ID transfer_group_id=划转组ID opening_batch_id=期初批次ID payout_batch_id=支付批次ID created_at=创建时间',
        '权益增加/扣减/历史余额/支付核销分别按事件类型解释；历史reported_balance不能视为当期利润；权益不等于现金')
dataset('dividend_payouts', '分红支付批次', 'dividend_payout_batches',
        'id=支付批次ID store_id=门店ID candidate_id=候选ID status=状态 total_amount_cents=批次金额（分） occurred_on=发生日期 available_funds_snapshot_cents=可用资金快照（分） safety_floor_snapshot_cents=安全线快照（分） safe_limit_snapshot_cents=安全限额快照（分） approval_request_id=审批ID submitted_at=提交时间 paid_at=支付时间 reversed_at=撤销时间 version=版本 updated_at=更新时间',
        'paid已支付、withdrawn已撤回；快照不是当前余额；与财务分红流水关联而非相加')
dataset('dividend_payout_lines', '分红支付分配明细', 'dividend_payout_lines',
        'id=支付明细ID payout_batch_id=支付批次ID participant_id=参与人ID cash_amount_cents=现金金额（分） entitlement_settled_cents=权益结清（分） non_cash_offset_snapshot_cents=非现金抵扣快照（分） outstanding_before_snapshot_cents=支付前欠付快照（分） created_at=创建时间',
        '现金支付、权益结清与非现金抵扣不可合并为现金；必须关联批次状态')
dataset('course_entitlements', '会员课程权益', 'member_courses',
        'id=会员课程ID member_id=会员ID course_product_id=产品ID course_category=课程类别 trial_opening_id=体验开课ID course_name=课程名称 start_date=开始日期 end_date=结束日期 total_days=总天数 used_days=已用天数 guarantee_session_count=保底课时 actual_session_count=实际课时 total_amount_cents=课程金额（分） paid_amount_cents=已付（分） status=课程状态 leave_active=请假生效 freeze_active=停卡生效 guarantee_extension_enabled=保底延期 current_course=当前课程 is_co_create_course=共创课程 updated_at=更新时间',
        '课程状态与订单/支付状态不同；请假、停卡和保底延期按源权益字段解释')
dataset('debt_current', '最新日正式课债快照', 't_course_debt_snapshot',
        'id=课债快照ID snapshot_date=快照日期 member_course_id=会员课程ID member_id=会员ID store_id=门店ID sales_coach_id=销售教练ID course_status=课程状态 calculation_mode=计算模式 remaining_days=剩余天数 remaining_guarantee_sessions=剩余保底课时 paid_amount_cents=已付（分） vested_revenue_cents=已确认实际收入（分） incremental_vested_revenue_cents=当日增量实际收入（分） course_debt_cents=课债（分） path_chosen=计算路径 is_legacy_gifted=旧赠送课 algorithm_version=算法版本 snapshot_run_id=快照批次 full_snapshot_run_id=完整快照批次 snapshot_origin=快照来源 calculated_at=计算时间',
        '仅源库最新快照日，不能保证全量完整，需按批次核对；课债是存量不跨日期累加；不能与旧课参考相加；只含单日增量，不能据此计算整月实际收入',
        'snapshot_date=(SELECT MAX(snapshot_date) FROM t_course_debt_snapshot)')
dataset('legacy_debt_current', '最新日旧课课债参考', 't_course_debt_legacy_reference_snapshot',
        'id=旧课参考ID snapshot_date=快照日期 member_course_id=会员课程ID member_id=会员ID store_id=门店ID course_status=课程状态 remaining_days=剩余天数 reference_unit_price_cents=参考日价（分） reference_debt_cents=参考课债（分） reference_delta_cents=参考变化（分） snapshot_kind=快照类型 reconstruction_basis=重建依据 reconstruction_quality=重建质量 algorithm_version=算法版本 snapshot_run_id=快照批次 calculated_at=计算时间',
        '仅旧系统参考，不代表真实收款或新系统负债；须与旧课参考运行批次核对完整性',
        'snapshot_date=(SELECT MAX(snapshot_date) FROM t_course_debt_legacy_reference_snapshot)')
dataset('legacy_debt_runs', '旧课参考计算批次', 't_course_debt_legacy_reference_run',
        'id=运行ID run_id=批次ID snapshot_date=快照日期 store_scope_id=门店范围 run_kind=运行类型 status=状态 candidate_count=候选数量 success_count=成功数量 failure_count=失败数量 written_count=写入数量 started_at=开始时间 completed_at=完成时间',
        '用于核对旧课参考的范围与完整性，不默认忽略失败批次')
dataset('refunds', '退课退款事实', 't_course_refund_records',
        'id=退款记录ID approval_request_id=审批ID member_course_id=会员课程ID member_id=会员ID store_id=门店ID selected_refund_strategy=退款策略 paid_amount_cents=已付（分） system_refund_amount_cents=系统退款（分） retained_actual_revenue_cents=保留实际收入（分） actual_refund_payout_cents=实际退款（分） store_expense_impact_cents=门店费用影响（分） finance_treatment=财务处理 refund_payment_account_id=退款支付账户ID status=状态 processing_mode=处理模式 applied_at=生效时间 paid_at=付款时间 settled_at=结算时间 updated_at=更新时间',
        'refund_expense费用与income_reduction收入冲减分开；财务处理为空须说明未知；与资金流水关联避免重复记支出')
dataset('installments', '订单分期计划', 'full_order_installments',
        'id=分期ID full_order_id=订单ID installment_number=期数 expected_amount_cents=应收金额（分） collection_opens_at=可收款时间 cumulative_usable_days=累计可用天数 status=状态 version=版本 updated_at=更新时间',
        '应收计划不代表实收，须关联订单及收款状态')
dataset('session_costs', '课时成本与跨店承担', 'session_records',
        'id=课时ID member_course_id=会员课程ID home_store_id=归属门店ID teaching_store_id=授课门店ID coach_id=授课教练ID home_coach_id_at_session=当时主教练ID business_date=营业日期 settlement_period=结算月份 status=课时状态 effective_status=有效状态 coach_session_fee_cents=教练课时费（分） co_create_bonus_cents=共创补贴（分） special_course_bonus_cents=特殊课补贴（分） venue_fee_cents=场地费（分） fee_payer_store_id=课时费承担门店ID venue_fee_payer_store_id=场地费承担门店ID venue_fee_receiver_store_id=场地费接收门店ID rate_version_id=费率版本ID updated_at=更新时间',
        '与现有课时明细同一事实的补充字段，不重复计算课时；pending_cross_store_claim及expired_unclaimed不能作为有效课时；成本不代表已发工资')
dataset('trial_openings', '体验课开课与激活', 'trial_course_openings',
        'id=体验开课ID member_id=会员ID course_product_id=产品ID product_name=产品名称 store_id=门店ID opening_coach_id=开课教练ID status=状态 confirmed_at=会员确认时间 activated_at=激活时间 activation_business_date=激活营业日 start_date=开始日期 end_date=结束日期 member_course_id=会员课程ID commission_cents=固定提成（分） deleted_at=删除时间 updated_at=更新时间',
        '会员确认、验券激活和正式课转化是不同事件；保留取消与删除状态')
dataset('trial_conversions', '体验课正式成交转化', 'trial_course_conversions',
        'id=转化ID opening_id=体验开课ID member_id=会员ID full_order_id=正式订单ID payment_order_id=收款ID attribution_coach_id=归因教练ID attribution_store_id=归因门店ID converted_at=转化时间 created_at=创建时间',
        '正式转化依据来源事实，按体验开课及正式收款关联；不能把每笔后续收款都当新转化')
dataset('transfers', '会员转店与价值核定', 'member_store_transfers',
        'id=转店ID approval_request_id=审批ID member_id=会员ID source_store_id=转出门店ID target_store_id=转入门店ID status=状态 valuation_version=核价版本 system_remaining_value_cents=系统剩余价值（分） settlement_value_cents=结算价值（分） estimated_commission_reserve_cents=提成预留（分） net_transfer_cents=净划转（分） paid_at=付款时间 effective_at=生效时间 updated_at=更新时间',
        'withdrawn撤回不作为生效转店；价值核定与实际付款独立')
dataset('transfer_settlements', '转店双边结算', 'member_store_transfer_settlements',
        'id=结算ID transfer_id=转店ID member_course_id=会员课程ID settlement_type=结算类型 amount_cents=结算金额（分） source_store_id=转出门店ID target_store_id=转入门店ID source_ledger_entry_id=转出账务流水ID target_ledger_entry_id=转入账务流水ID cash_source_ledger_entry_id=转出现金流水ID cash_target_ledger_entry_id=转入现金流水ID transfer_group_id=划转组ID status=状态 settled_at=结算时间 created_at=创建时间',
        '总部合并需抵销内部双边流转，不把两边都计收入')
dataset('approval_facts', '审批状态与处理事实', 'approval_requests',
        'id=审批ID template_id=审批类型ID status=状态 current_node_index=当前节点 store_id=门店ID target_type=目标类型 member_id=会员ID target_coach_id=目标教练ID submitted_at=提交时间 finalized_at=终结时间 version=版本 updated_at=更新时间',
        'approved仅审批通过，不表示资金已入账或实际支付；不采集payload、附件及自由文本')
dataset('approval_types', '审批业务类型', 'approval_templates',
        'id=审批类型ID name=名称 category=类别 enabled=模板启用 approver_node_count=节点数 updated_at=更新时间',
        '模板启用不代表对应业务功能开关已开启')
dataset('stores', '门店主数据', 'stores',
        'id=门店ID name=门店名称 city=城市 status=状态 open_date=开业日期 updated_at=更新时间',
        '门店ID为各数据集关联依据，含总部，不采集电话地址')
dataset('coaches', '教练岗位与归属', 'coaches',
        'id=教练ID staff_id=员工ID name=教练姓名 store_id=门店ID level=等级 level_effective_at=等级生效时间 role=岗位 status=状态 payroll_start_month=起薪月份 updated_at=更新时间',
        '当前归属不能替代历史业务发生时归属；不采集电话、住址与图片')
dataset('products', '课程产品配置', 'course_products',
        'id=产品ID name=产品名称 category=类别 status=状态 guarantee_session_count=保底课时 validity_days=有效天数 trial_commission_cents=体验课提成（分） total_amount_cents=标价（分） deposit_amount_cents=定金配置（分） final_payment_amount_cents=尾款配置（分） updated_at=更新时间',
        '当前标价不是历史订单成交价；历史事实以订单或课程快照为准')

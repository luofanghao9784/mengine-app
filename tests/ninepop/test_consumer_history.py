import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/ninepop'))
from consumer_history import CourseHistory, salary_month_scope, readers_for

class ConsumerHistoryTest(unittest.TestCase):
 def bundle(self):
  return {'tenantId':'t','completeHistory':True,'asOf':'2026-10-21T16:00:00+08:00','rows':{
   'member_courses':[{'id':'c','member_id':'m'}], 'members':[{'id':'m','store_id':'b'}],
   'full_orders':[{'id':'o','member_course_id':'c','confirmed_at':'2026-08-01T12:00:00','store_id':'a'}],
   'trial_course_openings':[], 'member_store_transfers':[{'id':'x','member_id':'m','source_store_id':'a','target_store_id':'b','status':'effective','effective_at':'2026-10-01T12:00:00'}],
   'member_store_transfer_reversals':[]}}
 def test_before_after_and_intraday(self):
  h=CourseHistory(self.bundle(),'t')
  self.assertEqual('a',h.resolve('c','2026-09-01')['store'])
  self.assertEqual('b',h.resolve('c','2026-10-02')['store'])
  self.assertIsNone(h.resolve('c','2026-10-01'))
  self.assertIsNone(h.resolve('c','2026-07-01'))
  self.assertIsNone(h.resolve('c','2026-10-22'))
  self.assertIsNone(h.resolve('c','2026-09-01','another-member'))
 def test_current_store_never_replaces_missing_or_conflicting_origin(self):
  b=self.bundle();b['rows']['full_orders']=[]
  self.assertIsNone(CourseHistory(b,'t').resolve('c','2026-10-02'))
  b=self.bundle();b['rows']['member_store_transfers'][0]['source_store_id']='c'
  self.assertIsNone(CourseHistory(b,'t').resolve('c','2026-10-02'))
 def test_reversal_is_effective_only(self):
  b=self.bundle();b['rows']['members'][0]['store_id']='a';b['rows']['member_store_transfers'][0]['status']='reversed'
  self.assertIsNone(CourseHistory(b,'t').resolve('c','2026-10-02'))
  b['rows']['member_store_transfer_reversals']=[{'id':'r','original_transfer_id':'x','member_id':'m','restore_store_id':'a','status':'effective','applied_at':'2026-10-10T12:00:00'}]
  h=CourseHistory(b,'t');self.assertEqual('b',h.resolve('c','2026-10-05')['store']);self.assertEqual('a',h.resolve('c','2026-10-11')['store'])
 def test_untrusted_and_duplicate_fail(self):
  b=self.bundle()
  with self.assertRaises(ValueError):CourseHistory(b,'other')
  b['completeHistory']=False
  with self.assertRaises(ValueError):CourseHistory(b,'t')
  b=self.bundle();b['rows']['member_courses']*=2
  with self.assertRaises(ValueError):CourseHistory(b,'t')
 def test_month_and_roles(self):
  row={'scope':'personal','owner_id':'coach','sales_month':'2026-09'}
  pays=[{'coach_id':'coach','period_month':'2026-09','store_id':'a'}]
  self.assertEqual('a',salary_month_scope(row,pays,['a','b']))
  self.assertIsNone(salary_month_scope(row,pays+[dict(pays[0],store_id='b')],['a','b']))
  grants={'manager':{'salary':['a'],'finance':['a']},'finance':{'salary':['a'],'finance':['a'],'dividend':['a']}}
  self.assertEqual(['finance'],readers_for('finance_sensitive','a',grants,{'manager','finance'}))
  self.assertEqual([],readers_for('salary','b',grants,{'manager','finance'}))
  self.assertEqual(['manager'],readers_for('salary','a',grants,{'manager'}))

class ConsumerAudienceTest(unittest.TestCase):
 def test_service_sources_do_not_inherit_enterprise_finance_readers(self):
  from consumer_projection import topic_for, topic_readers
  for table, module in [('member_contract_statuses','15'),('member_course_store_assignments','14'),('trial_course_openings','12')]:
   readers=topic_readers(topic_for(table,module),'manager',['owner','finance','shareholder'],'owner')
   self.assertEqual(['manager','owner'],readers)
  self.assertNotIn('manager',topic_readers(topic_for('finance_accounts','09'),'manager',['owner','finance'],'owner'))
  self.assertIn('manager',topic_readers(topic_for('trial_course_commission_entries','12'),'manager',['owner','finance'],'owner'))
  with self.assertRaises(ValueError):topic_for('unreviewed','99')

class HistoricalBasisTest(unittest.TestCase):
 def test_contract_uses_member_timeline_and_rejects_before_origin(self):
  b=ConsumerHistoryTest().bundle();h=CourseHistory(b,'t')
  self.assertEqual('a',h.resolve_member('m','2026-09-01')['store'])
  self.assertEqual('b',h.resolve_member('m','2026-10-02')['store'])
  self.assertIsNone(h.resolve_member('m','2026-07-01'))
 def test_level_is_bound_to_actual_fee_payer_period(self):
  from consumer_history import level_used_by_store
  level={'id':'l','coach_id':'c','level':'2','effective_from':'2026-09-01','effective_to':'2026-10-01'}
  session={'coach_id':'c','coach_level_at_session':'2','fee_payer_store_id':'a','business_date':'2026-09-10'}
  self.assertTrue(level_used_by_store(level,[session],'a'))
  self.assertFalse(level_used_by_store(level,[session],'b'))
  self.assertFalse(level_used_by_store(level,[dict(session,business_date='2026-10-01')],'a'))
  self.assertFalse(level_used_by_store(level,[dict(session,coach_level_at_session='3')],'a'))

import importlib.util
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('scope', Path(__file__).resolve().parents[2] / 'scripts/ninepop/history_scope.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

class ReviewedScope(unittest.TestCase):
    def setUp(self):
        self.bundle = {'tenantId':'synthetic', 'asOf':'2026-02-01', 'rows':{
            'sessions':[{'id':'one','teaching_store_id':'B','sales_store_id':'A','fee_payer_store_id':'A',
                         'status':'effective','coach_id':'c','amount':900,'salary':999,'dividend':888}],
            'transfers':[{'id':'t','member_id':'m','source_store_id':'A','target_store_id':'B','status':'effective','effective_at':'2026-01-01'}],
            'handover':[{'id':'h','transfer_id':'t','member_id':'m','balance':5,'original_receipt':'secret'}]}}
        self.rules = {
            'service':{'reviewed':True,'kind':'store_role','table':'sessions','topic':'service','storeColumn':'teaching_store_id','columns':['id','coach_id'],'required':['teaching_store_id'],'states':{'status':['effective']}},
            'pay':{'reviewed':True,'kind':'store_role','table':'sessions','topic':'salary','storeColumn':'fee_payer_store_id','columns':['id','amount'],'required':['fee_payer_store_id']},
            'handover':{'reviewed':True,'kind':'handover','table':'handover','topic':'service','factType':'service_handover','transfers':'transfers','columns':['id','member_id','balance']}}
        self.grants = {'managerA':{'salary':['A'],'service':['A']},'managerB':{'salary':['B'],'service':['B']},'finance':{'salary':['A','B'],'dividend':['A','B']}}
    def run_projection(self, purpose='service', actor='managerB', store='B'):
        return m.project_reviewed(self.bundle,self.rules,purpose,actor,store,self.grants,'synthetic')
    def test_cross_store_role_and_column_separation(self):
        self.assertEqual(self.run_projection(),[{'id':'one','coach_id':'c'}])
        self.assertEqual(self.run_projection('service','managerA','A'),[])
        self.assertEqual(self.run_projection('pay','managerA','A'),[{'id':'one','amount':900}])
        self.assertEqual(self.run_projection('pay'),[])
    def test_tenant_and_topic_and_revocation(self):
        with self.assertRaises(PermissionError): self.run_projection('pay','managerB','A')
        self.rules['pay']['topic']='dividend'
        with self.assertRaises(PermissionError): self.run_projection('pay','managerA','A')
        self.grants['managerB']['service']=[]
        with self.assertRaises(PermissionError): self.run_projection()
        self.bundle['tenantId']='other'
        with self.assertRaises(PermissionError): self.run_projection()
    def test_only_service_handover_not_original_finance(self):
        self.assertEqual(self.run_projection('handover'),[{'id':'h','member_id':'m','balance':5}])
        self.assertEqual(self.run_projection('handover','managerA','A'),[])
        self.rules['handover']['topic']='salary'
        with self.assertRaises(ValueError): self.run_projection('handover')
    def test_pending_future_reversed_and_ambiguous_transfer(self):
        t=self.bundle['rows']['transfers'][0]
        for status in ['pending','reversed','waiting_effective']:
            t['status']=status; self.assertEqual(self.run_projection('handover'),[])
        t['status']='effective';t['effective_at']='2027-01-01'
        self.assertEqual(self.run_projection('handover'),[])
        t['effective_at']='2026-01-01';self.bundle['rows']['transfers'].append(dict(t))
        self.assertEqual(self.run_projection('handover'),[])
    def test_missing_field_and_duplicate_fail_entire_projection(self):
        del self.bundle['rows']['sessions'][0]['amount']
        with self.assertRaises(ValueError):self.run_projection('pay','managerA','A')
        self.bundle['rows']['sessions'].append(dict(self.bundle['rows']['sessions'][0]))
        with self.assertRaises(ValueError):self.run_projection()
    def test_historical_salary_does_not_follow_current_store(self):
        self.bundle['rows'].update({'basis':[{'id':'b','coach':'c','date':'2025-12-01','rate':10}],
          'employment':[{'id':'old','coach':'c','store':'A','start':'2025-01-01','end':'2026-01-01'},
                        {'id':'new','coach':'c','store':'B','start':'2026-01-01','end':None}]})
        p={'employment':{'kind':'direct','column':'store','stores':['A','B']},'basis':{'kind':'relation','reviewed':True,'parent':'employment','column':'coach','parentColumn':'coach','at':'date','from':'start','to':'end'}}
        self.rules['basis']={'reviewed':True,'kind':'historical','table':'basis','topic':'salary','columns':['id','rate'],'policies':p}
        self.assertEqual(self.run_projection('basis','managerA','A'),[{'id':'b','rate':10}])
        self.assertEqual(self.run_projection('basis'),[])
        self.bundle['rows']['employment'][1]['start']='2025-01-01'
        self.assertEqual(self.run_projection('basis','managerA','A'),[])
    def test_names_only_referenced_ids_no_fallback_or_phone(self):
        identities={'staffs':[{'id':'s','name':'合成员工','phone':'secret'},{'id':'other','name':'合成员工'}],
                    'coaches':[{'id':'c','staff_id':'s','name':'not-used'}]}
        out=m.attach_minimal_names(self.run_projection(),identities,'coach_id','coach')
        self.assertEqual(out,[{'id':'one','coach_id':'c','display_name':'合成员工','name_status':'resolved'}])
        identities['coaches'][0]['staff_id']='missing'
        self.assertEqual(m.attach_minimal_names(self.run_projection(),identities,'coach_id','coach')[0]['name_status'],'pending_mapping')
    def test_unknown_purpose_and_unreviewed_rejected(self):
        with self.assertRaises(PermissionError):self.run_projection('unknown')
        self.rules['service']['reviewed']=False
        with self.assertRaises(PermissionError):self.run_projection()

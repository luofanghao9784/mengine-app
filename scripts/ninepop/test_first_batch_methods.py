import unittest
from first_batch_methods import evaluate

class MethodsTest(unittest.TestCase):
    def data(self):
        return {'full_orders':[{'id':'o','store_id':'s','member_course_id':'c','order_status':'completed','deleted_at':None}], 'payment_orders':[], 't_course_refund_records':[]}
    def test_store_rejected(self):
        with self.assertRaises(ValueError): evaluate(self.data(),'other')
    def test_duplicate_rejected(self):
        d=self.data();d['full_orders']*=2
        with self.assertRaises(ValueError): evaluate(d,'s')
    def test_confirmation_is_not_finance(self):
        d=self.data();d['payment_orders']=[{'id':'p','store_id':'s','full_order_id':'o','status':'voucher_uploaded','confirmed_at':None}]
        r=evaluate(d,'s');self.assertEqual(len(r['issues']),2);self.assertFalse(r['financialTotalsComputed'])
    def test_zero_refund_not_missing_payment(self):
        d=self.data();d['t_course_refund_records']=[{'id':'r','store_id':'s','member_course_id':'c','status':'applied','applied_at':'2026-10-01','actual_refund_payout_cents':'0','paid_at':None}]
        self.assertEqual(evaluate(d,'s')['issues'],[])
    def test_unknown_payout_not_zero(self):
        d=self.data();d['t_course_refund_records']=[{'id':'r','store_id':'s','member_course_id':'c','status':'applied','applied_at':'2026-10-01','actual_refund_payout_cents':None}]
        self.assertEqual(evaluate(d,'s')['issues'][0]['code'],'REFUND_PAYOUT_UNKNOWN')
    def test_positive_payout_needs_event(self):
        d=self.data();d['t_course_refund_records']=[{'id':'r','store_id':'s','member_course_id':'c','status':'applied','applied_at':'2026-10-01','actual_refund_payout_cents':'100'}]
        self.assertEqual(evaluate(d,'s')['issues'][0]['code'],'REFUND_PAYMENT_DATE_MISSING')
    def test_soft_deleted_parent_review(self):
        d=self.data();d['full_orders'][0]['deleted_at']='2026-01-01';d['payment_orders']=[{'id':'p','store_id':'s','full_order_id':'o','status':'canceled'}]
        self.assertEqual(evaluate(d,'s')['issues'][0]['code'],'PARENT_SOFT_DELETED_REVIEW')
if __name__=='__main__':unittest.main()

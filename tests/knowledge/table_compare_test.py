import io, json, sys, tempfile, unittest, zipfile
from pathlib import Path
from openpyxl import Workbook
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'workers/parser'))
import sandbox

class TableComparisonTests(unittest.TestCase):
    def run_table(self, rows, request=None, transform=None):
        b=Workbook();s=b.active;s.title='经营';s.append(['期间','门店','金额'])
        for row in rows:s.append(row)
        out=io.BytesIO();b.save(out);data=out.getvalue()
        if transform:
            changed=io.BytesIO()
            with zipfile.ZipFile(io.BytesIO(data)) as src,zipfile.ZipFile(changed,'w',zipfile.ZIP_DEFLATED) as dst:
                for name in src.namelist():dst.writestr(name,transform(name,src.read(name)))
            data=changed.getvalue()
        args={'sheet':'经营','range':f'A1:C{len(rows)+1}','groupColumn':'B','periodColumn':'A','valueColumn':'C','baseline':'前期','current':'本期'}
        args.update(request or {})
        with tempfile.TemporaryDirectory() as job:
            Path(job,'input').write_bytes(data);Path(job,'request.json').write_text(json.dumps(args))
            result=json.loads(sandbox.run(job,'table-compare'))
            self.assertEqual(data,Path(job,'input').read_bytes())
            return result
    def test_exact_sums_changes_and_competition_ranks(self):
        r=self.run_table([['前期','甲',.1],['前期','甲',.2],['前期','乙',.3],['本期','甲',.6],['本期','乙',.3]])
        self.assertEqual('COMPUTED',r['status']);a,b=r['rows']
        self.assertEqual(('0.3','0.6','0.3','100.00',1,1),(a['baseline'],a['current'],a['difference'],a['changePercent'],a['baselineRank'],a['currentRank']))
        self.assertEqual((1,2),(b['baselineRank'],b['currentRank']));self.assertEqual('0.9',r['totals']['current'])
        self.assertEqual(5,len(r['inputs']));self.assertEqual('C2',r['inputs'][0]['cell'])
    def test_missing_period_and_zero_baseline_never_become_zero_growth(self):
        r=self.run_table([['前期','甲',0],['本期','甲',20],['本期','乙',30]])
        self.assertIsNone(r['rows'][0]['changePercent']);self.assertEqual('NON_POSITIVE_BASELINE',r['rows'][0]['issue'])
        self.assertIsNone(r['rows'][1]['baseline']);self.assertIsNone(r['rows'][1]['difference']);self.assertIsNone(r['totals']['difference'])
    def test_formula_error_boolean_blank_and_ambiguous_numbers_fail(self):
        for value in ['=1+1',True,None,'1,000','NaN']:
            r=self.run_table([['前期','甲',100],['本期','甲',value]])
            self.assertEqual('FAILED',r['status'],r);self.assertNotIn('rows',r)
    def test_large_decimals_are_read_from_xml_without_float_loss(self):
        def change(name,body):
            return body.replace(b'<v>123</v>',b'<v>12345678901234567890.123456789012</v>') if name.endswith('sheet1.xml') else body
        r=self.run_table([['前期','甲',123],['本期','甲',123]],transform=change)
        self.assertEqual('12345678901234567890.123456789012',r['rows'][0]['baseline']);self.assertEqual('0.000000000000',r['rows'][0]['difference'])
    def test_only_requested_rows_periods_and_columns_are_used(self):
        r=self.run_table([['前期','甲',10],['本期','甲',20],['其他期','甲',999],['本期','乙',100]],request={'range':'A1:C4'})
        self.assertEqual([4],r['ignoredRows']);self.assertEqual(2,r['matchedRows']);self.assertEqual('20',r['totals']['current'])
    def test_range_and_duplicate_column_limits(self):
        for request in [{'range':'A1:C502'},{'range':'A1:Z3'},{'range':'A0:C3'},{'range':'C1:A3'},{'valueColumn':'A'}]:
            self.assertEqual('FAILED',self.run_table([['前期','甲',1],['本期','甲',2]],request=request)['status'])
    def test_duplicate_cells_and_entities_fail(self):
        for transform in [
            lambda n,b:b.replace(b'<c r="C2"',b'<c r="B2"') if n.endswith('sheet1.xml') else b,
            lambda n,b:b'<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]>'+b if n.endswith('sheet1.xml') else b,
        ]:
            self.assertEqual('FAILED',self.run_table([['前期','甲',1],['本期','甲',2]],transform=transform)['status'])
    def test_stale_dimension_does_not_truncate_data(self):
        import re
        r=self.run_table([['前期','甲',1],['本期','甲',2]],transform=lambda n,b:re.sub(rb'<dimension ref="[^"]+"',b'<dimension ref="A1:A1"',b) if n.endswith('sheet1.xml') else b)
        self.assertEqual('2',r['rows'][0]['current'])

if __name__=='__main__':unittest.main()

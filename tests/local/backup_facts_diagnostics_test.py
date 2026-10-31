"""Diagnostic observer must not weaken backup fingerprints; no PostgreSQL is simulated as passing."""
import pathlib,sys,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/"scripts/local"))
import backup

class FactsDiagnosticsTest(unittest.TestCase):
    def sql(self, query, fingerprint=False):
        self.calls.append((query,fingerprint))
        if "FROM flyway_schema_history" in query:
            return backup.json.dumps([{"installed_rank":i,"version":m["version"],"script":m["script"],"success":True}
                                      for i,m in enumerate(backup.migrations(),1)])
        if "FROM pg_tables" in query:return "sample_table"
        if query.startswith("COPY"):return "a"*64
        if query.startswith("SELECT count(*)"):return "3"
        raise AssertionError("unexpected query")
    def setUp(self):self.calls=[]
    def test_observer_preserves_result_and_query_sequence(self):
        before=backup.facts(self.sql);calls=list(self.calls);self.calls=[]
        events=[]
        after=backup.facts(self.sql,events.append)
        self.assertEqual(before,after)
        self.assertEqual(calls,self.calls)
        self.assertEqual({"sample_table":{"rows":3,"sha256":"a"*64}},after)
        self.assertEqual(["migration_history","table_list","table_copy","table_count"],[e["phase"] for e in events])
        self.assertEqual(3,events[-1]["rows"])
        self.assertTrue(all(set(e)<= {"phase","table","seconds","ok","rows","errorType"} for e in events))
    def test_copy_failure_propagates_without_count(self):
        original=self.sql
        def sql(query,fingerprint=False):
            if query.startswith("COPY"):raise ValueError("synthetic secret must not be logged")
            return original(query,fingerprint)
        events=[]
        with self.assertRaises(ValueError):backup.facts(sql,events.append)
        self.assertFalse(any(q.startswith("SELECT count(*)") for q,_ in self.calls))
        self.assertFalse(events[-1]["ok"])
        self.assertNotIn("synthetic secret",str(events))
    def test_observer_stop_never_returns_partial_success(self):
        def stop(event):
            if event["phase"]=="table_count":raise RuntimeError("diagnostic budget")
        with self.assertRaisesRegex(RuntimeError,"diagnostic budget"):backup.facts(self.sql,stop)

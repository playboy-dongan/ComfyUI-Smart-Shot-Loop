import importlib.util
import pathlib
import unittest
spec = importlib.util.spec_from_file_location("shot_nodes", pathlib.Path(__file__).parents[1] / "__init__.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
class Nodes(unittest.TestCase):
    def test_five_pairs(self):
        node = m.ShotLoopPrompts()
        for i in range(5):
            image, video, prefix = node.select(m.DEFAULT_SHOTS, i, "run-123")
            self.assertIn(str(i+1), image)
            self.assertIn(str(i+1), video)
            self.assertTrue(prefix.endswith(f"shot_{i+1:02d}"))
    def test_invalid(self):
        for raw in ('[]', '{}', '[{"image":"x","video":""}]'):
            with self.assertRaises(ValueError): m.parse_shots(raw)
    def test_index_and_safe_prefix(self):
        with self.assertRaises(ValueError): m.ShotLoopPrompts().select(m.DEFAULT_SHOTS, 5, 'x')
        self.assertNotIn('..', m.ShotLoopPrompts().select(m.DEFAULT_SHOTS, 0, '../danger')[2])
    def test_unified_accepts_controls_and_emits_prompts(self):
        result = m.SmartShotLoop().select(m.DEFAULT_SHOTS, 0, "run", sound_enabled=False, delay_seconds=2, video_output_node_id="9", timeout_minutes=30, sound_volume=0.1)
        self.assertEqual(len(result), 3)
        self.assertIn("1", result[0])
        self.assertIn("SmartShotLoop", m.NODE_CLASS_MAPPINGS)
if __name__ == '__main__': unittest.main()

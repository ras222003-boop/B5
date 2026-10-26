"""Unit fixtures test evidence classification, never masquerade as camera captures."""
import unittest
from camera_probe import capture_status


class CaptureEvidenceTests(unittest.TestCase):
    def test_no_read_is_not_a_device_success(self):
        self.assertEqual(capture_status(True, []), 'CAMERA_UNAVAILABLE')

    def test_dark_frames_are_not_a_scene_test(self):
        frames=[{'visibleSceneEvidence':False,'frameHash':'constant'}]*12
        self.assertEqual(capture_status(True,frames),'LOW_OR_UNIFORM_CAPTURE')

    def test_warmup_changes_do_not_hide_frozen_settled_output(self):
        frames=[{'visibleSceneEvidence':True,'frameHash':str(i)} for i in range(3)]
        frames += [{'visibleSceneEvidence':True,'frameHash':'settled'}]*12
        self.assertEqual(capture_status(True,frames),'DEVICE_OUTPUT_STATIC_SCENE_UNVERIFIED')

    def test_varied_visible_frames_have_limited_operational_status(self):
        frames=[{'visibleSceneEvidence':True,'frameHash':str(i)} for i in range(12)]
        self.assertEqual(capture_status(True,frames),'VISIBLE_CHANGING_FRAME_CAPTURE')


if __name__=='__main__':
    unittest.main()

import math
import unittest

from generate import Camera, DOWN, UNCERTAIN, UP, stair_direction


class GeometryTests(unittest.TestCase):
    def test_direction_is_relative_to_camera_side(self):
        self.assertEqual(stair_direction((0, -3, 1.6), (0, 0, 0), (0, 0, 0), (0, 1), 6, .3)[0], UP)
        self.assertEqual(stair_direction((0, 5, 2.5), (0, 0, 0), (0, 0, 0), (0, 1), 6, .3)[0], DOWN)
        self.assertEqual(stair_direction((5, .9, 1.6), (0, .9, 0), (0, 0, 0), (0, 1), 6, .3)[0], UNCERTAIN)

    def test_direction_requires_camera_to_look_along_stair_axis(self):
        self.assertEqual(stair_direction((0, -3, 1.6), (0, -6, 1.6),
                                         (0, 0, 0), (0, 1), 6, .3)[0], UNCERTAIN)
        self.assertEqual(stair_direction((0, 5, 2.5), (2, 5, 2.5),
                                         (0, 0, 0), (0, 1), 6, .3)[0], UNCERTAIN)

    def test_pinhole_projection_has_correct_center_and_orientation(self):
        camera = Camera((0, -3, 1.6), (0, 0, 1.6), 64)
        center = camera.project((0, 0, 1.6), 320, 240)
        right = camera.project((1, 0, 1.6), 320, 240)
        higher = camera.project((0, 0, 2.6), 320, 240)
        self.assertTrue(math.isclose(center[0], 160))
        self.assertTrue(math.isclose(center[1], 120))
        self.assertGreater(right[0], center[0])
        self.assertLess(higher[1], center[1])
        self.assertIsNone(camera.project((0, -4, 1.6), 320, 240))


if __name__ == "__main__":
    unittest.main()

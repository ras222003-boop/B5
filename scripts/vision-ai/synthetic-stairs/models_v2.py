"""The exact V1 detector and a compatible small V2 research detector."""
from __future__ import annotations

import numpy as np
import torch
from PIL import Image
from torch import nn


IMAGE_SIZE = 128
CLASS_IDS_V1 = (None, 2301, 2302, 2303)
CLASS_IDS_V2 = (None, 2301, 2302, 2303, 2304)
CLASS_NAMES = {None: 'background', 2301: 'stairs_up', 2302: 'stairs_down',
               2303: 'stairs_present_uncertain_direction', 2304: 'escalator'}


class TinyDetectorV1(nn.Module):
    """State dict layout matches PR #48 weights.pt exactly."""
    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(3, 16, 3, 2, 1), nn.ReLU(),
            nn.Conv2d(16, 32, 3, 2, 1), nn.ReLU(),
            nn.Conv2d(32, 48, 3, 2, 1), nn.ReLU(),
            nn.Conv2d(48, 64, 3, 2, 1), nn.ReLU(),
            nn.AdaptiveAvgPool2d((4, 4)), nn.Flatten(),
            nn.Linear(64 * 4 * 4, 96), nn.ReLU(),
        )
        self.classifier = nn.Linear(96, 4)
        self.box_head = nn.Linear(96, 4)

    def forward(self, images):
        feature = self.features(images)
        logits = self.classifier(feature)
        x, y, width, height = torch.sigmoid(self.box_head(feature)).unbind(dim=1)
        box = torch.stack((x, y, width * (1 - x), height * (1 - y)), dim=1)
        return logits, box


class TinyDetectorV2(nn.Module):
    def __init__(self, width='base'):
        super().__init__()
        if width not in ('base', 'wide', 'wide192', 'factorized'):
            raise ValueError('Unknown research architecture width')
        self.factorized = width == 'factorized'
        self.input_size = 192 if width == 'wide192' else 128
        channels = (16, 32, 48, 64) if width == 'base' else (24, 48, 72, 96)
        blocks = []
        source = 3
        for target in channels:
            blocks.extend((nn.Conv2d(source, target, 3, 2, 1), nn.ReLU()))
            source = target
        blocks.extend((nn.AdaptiveAvgPool2d((4, 4)), nn.Flatten(),
                       nn.Linear(channels[-1] * 4 * 4, 128), nn.ReLU()))
        self.features = nn.Sequential(*blocks)
        if self.factorized:
            self.presence_head = nn.Linear(128, 3)  # background, fixed, escalator
            self.direction_head = nn.Linear(128, 3)  # up, down, uncertain
        else:
            self.classifier = nn.Linear(128, 5)
        self.box_head = nn.Linear(128, 4)

    def forward_components(self, images):
        feature = self.features(images)
        if self.factorized:
            presence_logits = self.presence_head(feature)
            direction_logits = self.direction_head(feature)
            presence = torch.softmax(presence_logits, dim=1)
            direction = torch.softmax(direction_logits, dim=1)
            probabilities = torch.stack((presence[:, 0],
                presence[:, 1] * direction[:, 0],
                presence[:, 1] * direction[:, 1],
                presence[:, 1] * direction[:, 2], presence[:, 2]), dim=1)
            logits = torch.log(probabilities.clamp(min=1e-8))
        else:
            presence_logits = direction_logits = None
            logits = self.classifier(feature)
        raw = torch.sigmoid(self.box_head(feature))
        width = .05 + .95 * raw[:, 2]
        height = .05 + .95 * raw[:, 3]
        x = raw[:, 0] * (1 - width)
        y = raw[:, 1] * (1 - height)
        return logits, torch.stack((x, y, width, height), dim=1), presence_logits, direction_logits

    def forward(self, images):
        logits, boxes, _, _ = self.forward_components(images)
        return logits, boxes


def image_tensor(path, size=IMAGE_SIZE):
    with Image.open(path) as source:
        if source.width * source.height > 2_000_000:
            raise ValueError('Synthetic input exceeds two megapixels')
        image = source.convert('RGB').resize((size, size), Image.Resampling.BILINEAR)
        array = np.asarray(image, dtype=np.float32).transpose(2, 0, 1) / 255.0
    return torch.from_numpy(array)


def classify(logits, box, class_ids, threshold=.5):
    scores = torch.softmax(logits, dim=0)
    confidence = float(1 - scores[0])
    index = int(torch.argmax(scores[1:])) + 1
    if confidence < threshold:
        return {'classId': None, 'score': float(scores[0]), 'box': None}
    return {'classId': class_ids[index], 'score': confidence,
            'box': [float(value) for value in box]}

import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from rights import check_row,check_initial,TINY_SHA
BASE=Path(__file__).resolve().parents[2]/'.vision-ai/v3-unit-tests'
BASE.mkdir(parents=True,exist_ok=True)

class RightsGate(unittest.TestCase):
    def test_restricted_weights_cannot_be_renamed_clean(self):
        with patch('rights.sha',return_value='a'*64):
            with self.assertRaisesRegex(ValueError,'original publisher'):check_initial('renamed-clean.pth',{'deniedWeightHashes':{'a'*64:'old.onnx'}})
    def test_original_hash_is_still_denied_if_lineage_was_flagged(self):
        with patch('rights.sha',return_value=TINY_SHA):
            with self.assertRaises(ValueError):check_initial('any.pth',{'deniedWeightHashes':{TINY_SHA:'flagged'}})
    def test_bdd_cannot_be_relabelled_as_permissive(self):
        with tempfile.TemporaryDirectory(dir=BASE) as d:
            p=Path(d).resolve();self.assertEqual(p.parent,BASE)
            (p/'r.json').write_text(json.dumps(dict(commercialTrainingAllowed=True,licenseId='MIT',humanApproval=False)))
            with self.assertRaises(ValueError):check_row(p,dict(rights='r.json',source='bdd100k'))
    def test_rights_assertion_without_actual_evidence_is_rejected(self):
        with tempfile.TemporaryDirectory(dir=BASE) as d:
            p=Path(d).resolve();self.assertEqual(p.parent,BASE)
            (p/'r.json').write_text(json.dumps(dict(commercialTrainingAllowed=True,licenseId='MIT',humanApproval=False,source='publisher',licenceEvidenceSha256='a'*64)))
            with self.assertRaisesRegex(ValueError,'evidence missing'):check_row(p,dict(rights='r.json',source='test'))

if __name__=='__main__':unittest.main()

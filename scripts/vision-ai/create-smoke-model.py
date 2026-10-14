"""Create a constant ONNX adapter fixture. This is NOT a detector or trained model."""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    import onnx
    from onnx import TensorProto, helper
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    taxonomy_path = root / "ml/vision/taxonomy.v1.json"
    taxonomy = json.loads(taxonomy_path.read_text(encoding="utf-8"))
    specs = [("boxes", TensorProto.FLOAT, [1, 4], [.1, .2, .4, .6]),
             ("labels", TensorProto.INT64, [1], [2]), ("scores", TensorProto.FLOAT, [1], [.9])]
    graph = helper.make_graph(
        [helper.make_node("Constant", [], [name], value=helper.make_tensor(name, dtype, shape, values)) for name, dtype, shape, values in specs],
        "synthetic-adapter-test-only", [helper.make_tensor_value_info("image", TensorProto.FLOAT, [1, 3, 320, 320])],
        [helper.make_tensor_value_info(name, dtype, shape) for name, dtype, shape, _ in specs])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)], ir_version=9)
    onnx.checker.check_model(model)
    onnx.save(model, output / "model.onnx")
    contract = {"schemaVersion": 1, "syntheticOnly": True, "architecture": "constant-test-fixture-not-trained",
                "modelSha256": hashlib.sha256((output / "model.onnx").read_bytes()).hexdigest(),
                "taxonomySha256": hashlib.sha256(taxonomy_path.read_bytes()).hexdigest(),
                "categories": [{"id": c["id"], "name": c["key"]} for c in taxonomy["classes"] if c["kind"] != "surface"],
                "scoreThreshold": .45, "maxDetections": 12, "nmsIoU": .6}
    (output / "browser-contract.json").write_text(json.dumps(contract, indent=2), encoding="utf-8")
    print("SYNTHETIC CONTRACT FIXTURE ONLY; no training performed")


if __name__ == "__main__":
    main()

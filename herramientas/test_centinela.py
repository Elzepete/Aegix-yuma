"""Pruebas del centinela: verifica una auditoría sellada por aegix (Go) y detecta alteraciones.

    python3 -m unittest herramientas/test_centinela.py
"""
import hashlib
import hmac
import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import centinela  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def sellar(clave: bytes, evento: dict, anterior: str) -> bytes:
    """Réplica de sellar() en Go, para no depender de compilar aegix en la prueba."""
    if anterior:
        evento = {**evento, "hash_anterior": anterior}
    cuerpo = json.dumps(evento, separators=(",", ":")).encode()
    sello = hmac.new(clave, cuerpo, hashlib.sha256).hexdigest()
    return cuerpo[:-1] + f',"sello":"{sello}"}}'.encode()


class Centinela(unittest.TestCase):
    def setUp(self):
        self.clave = hmac.new(b"clave-de-prueba", b"sello-auditoria", hashlib.sha256).digest()
        self.lineas, anterior = [], ""
        for i, d in enumerate(["aprobar", "retener", "desafiar"]):
            linea = sellar(self.clave, {"referencia": f"{i:064x}", "decision": d, "puntaje": 0.7}, anterior)
            self.lineas.append(linea)
            anterior = hashlib.sha256(linea).hexdigest()

    def test_cadena_integra_y_alteraciones(self):
        self.assertTrue(centinela.verificar_cadena(self.lineas, self.clave)["integra"])
        alterada = [self.lineas[0], self.lineas[1].replace(b"0.7", b"0.1"), self.lineas[2]]
        self.assertFalse(centinela.verificar_cadena(alterada, self.clave)["integra"])
        self.assertFalse(centinela.verificar_cadena([self.lineas[0], self.lineas[2]], self.clave)["integra"])
        self.assertFalse(centinela.verificar_cadena(self.lineas, b"otra")["integra"])

    def test_oleada(self):
        estable = [0.0] * 600 + [0.4] * 100
        self.assertEqual(centinela.evaluar_oleada(estable[:500] + estable[:200])["estado"], "ESTABLE")
        self.assertEqual(centinela.evaluar_oleada([0.0] * 800 + [0.7] * 200)["estado"], "AMENAZA_EMERGENTE")
        self.assertEqual(centinela.evaluar_oleada([0.0] * 10)["estado"], "SIN_DATOS_SUFICIENTES")

    def test_verifica_una_auditoria_escrita_por_aegix(self):
        """Interoperabilidad real: aegix (Go) escribe y sella; el centinela (Python) verifica."""
        if subprocess.run(["go", "version"], capture_output=True).returncode != 0:
            self.skipTest("go no está instalado")
        with tempfile.TemporaryDirectory() as d:
            prueba = os.path.join(RAIZ, "internal", "registro", "zz_centinela_test.go")
            ruta = os.path.join(d, "a.jsonl")
            with open(prueba, "w") as f:
                f.write(f'''package registro
import "testing"
func TestEscribirParaCentinela(t *testing.T) {{
	r, _ := Abrir({json.dumps(ruta)}, "clave-centinela")
	r.Guardar(Evento{{ID: "YW1", Accion: "retener", Puntaje: 1, Razones: []string{{"dispositivo nuevo <&>"}}}})
	r.Guardar(Evento{{ID: "YW2", Accion: "aprobar"}})
	esperar(t, func() bool {{ return r.Indicadores().Total == 2 }})
	r.Close()
}}
''')
            try:
                subprocess.run(["go", "test", "-run", "TestEscribirParaCentinela", "./internal/registro/"], cwd=RAIZ, check=True, capture_output=True)
            finally:
                os.remove(prueba)
            os.environ["YUMA_AUDIT_KEY"] = "clave-centinela"
            try:
                r = centinela.verificar_cadena(centinela.leer_lineas(ruta), centinela.clave_sello(ruta))
            finally:
                del os.environ["YUMA_AUDIT_KEY"]
            self.assertTrue(r["integra"], r)
            self.assertEqual(r["selladas"], 2)


if __name__ == "__main__":
    unittest.main()

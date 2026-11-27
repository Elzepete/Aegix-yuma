package contexto

import "testing"

func TestClientesPreviosCuentaOtrosClientesHastaElTope(t *testing.T) {
	h := NuevoHistorial()
	if n := h.ClientesPrevios("COM1", "c1", 4); n != 0 {
		t.Fatalf("comercio nuevo: %d", n)
	}
	if n := h.ClientesPrevios("COM1", "c1", 4); n != 0 {
		t.Fatalf("el mismo cliente no cuenta como otro: %d", n)
	}
	for i, c := range []string{"c2", "c3", "c4", "c5", "c6"} {
		if n := h.ClientesPrevios("COM1", c, 4); n != min(i+1, 4) {
			t.Fatalf("pago %d de %s: %d otros clientes", i, c, n)
		}
	}
	if n := h.ClientesPrevios("COM2", "c2", 4); n != 0 {
		t.Fatal("cada comercio lleva su propia cuenta")
	}
}

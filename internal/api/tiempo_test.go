package api

import (
	"context"
	"errors"
	"net/netip"
	"testing"
	"time"

	"escudo-yuma/internal/contexto"
	"escudo-yuma/internal/defensas"
	"escudo-yuma/internal/reglas"
)

type proveedorLento struct {
	inicio  chan struct{}
	liberar chan struct{}
}

func (p proveedorLento) Consultar(netip.Addr, contexto.Datos) (contexto.Origen, error) {
	close(p.inicio)
	<-p.liberar
	return contexto.Origen{}, nil
}

func TestEvaluacionRespetaCancelacion(t *testing.T) {
	p := proveedorLento{inicio: make(chan struct{}), liberar: make(chan struct{})}
	defer close(p.liberar)
	ctx, cancelar := context.WithCancel(context.Background())
	defer cancelar()
	done := make(chan error, 1)
	go func() {
		_, err := evaluar(ctx, make(chan struct{}, 1), p, contexto.NuevoHistorial(),
			&reglas.Config{}, defensas.Solicitud{}, netip.Addr{}, time.Time{})
		done <- err
	}()
	select {
	case <-p.inicio:
	case <-time.After(time.Second):
		t.Fatal("la evaluación no inició")
	}
	cancelar()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("error inesperado: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("la evaluación no respondió a la cancelación")
	}
}

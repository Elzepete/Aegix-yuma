package defensas

import (
	"fmt"
	"net/netip"
	"sync"
	"time"
)

type Limites struct {
	Cliente, IP, Dispositivo int
}

type clave struct {
	tipo, valor string
}

type contador struct {
	inicio time.Time
	total  int
}

type Limitador struct {
	mu             sync.Mutex
	limites        Limites
	contadores     map[clave]contador
	ultimaLimpieza time.Time
}

func NuevoLimitador(limites Limites) *Limitador {
	return &Limitador{limites: limites, contadores: make(map[clave]contador)}
}

// Admitir aplica ventanas de un segundo y actualiza los tres contadores juntos.
func (l *Limitador) Admitir(ahora time.Time, cliente string, ip netip.Addr, dispositivo string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if ahora.Sub(l.ultimaLimpieza) >= time.Minute {
		for k, c := range l.contadores {
			if ahora.Sub(c.inicio) >= time.Second {
				delete(l.contadores, k)
			}
		}
		l.ultimaLimpieza = ahora
	}
	claves := [...]clave{{"cliente", cliente}, {"IP", ip.String()}, {"dispositivo", dispositivo}}
	topes := [...]int{l.limites.Cliente, l.limites.IP, l.limites.Dispositivo}
	var vigentes [len(claves)]contador
	for i, k := range claves {
		c := l.contadores[k]
		if ahora.Sub(c.inicio) >= time.Second {
			c = contador{inicio: ahora}
		}
		if c.total >= topes[i] {
			return fmt.Errorf("límite de solicitudes por %s superado", k.tipo)
		}
		vigentes[i] = c
	}
	for i, k := range claves {
		c := vigentes[i]
		c.total++
		l.contadores[k] = c
	}
	return nil
}

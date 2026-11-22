# Reporte de indicadores · Escudo Yuma (aegix)

Medido el 22 de noviembre de 2026 con las 120.972 transacciones del reto (1 de mayo a 31 de octubre de 2026),
enviadas por el simulador a aegix con 4 clientes en paralelo y calificadas por el sandbox del reto.

## Resultado principal

| Indicador | Motor actual (línea base) | aegix etapa-5.2 | **aegix etapa-5.3** |
| --- | ---: | ---: | ---: |
| Fraude detectado | 62,6 %, después de autorizar | 81,4 % | **81,5 %**, antes de autorizar |
| Monto de fraude protegido | 85,4 %, después de autorizar | 87,1 % | **87,0 %** |
| Falsos positivos (legítimas retenidas ÷ retenidas) | 89,0 % | 22,0 % | **17,7 %** |
| Clientes legítimos bloqueados | — | 0,33 % | **0,25 %** |
| Desafíos (código al cliente) | — | 3.902 | **3.142** (−19 %) |
| Retenciones para el analista | 9.687 alertas | 1.199 | **1.102** |
| Latencia p99 vista por el cliente | lotes cada 15 min | 5,5 ms | **5,3 ms** (límite 300 ms) |
| Rendimiento sostenido | — | 1.143 TPS | **más de 1.100 TPS** (pico exigido 150) |
| Errores | — | 0 | **0** |

Detectado = fraude con decisión desafiar, retener o rechazar (definición del sandbox). La línea base sale de
`linea_base.py` del reto y alerta *después* de que el dinero salió; aegix decide *antes*.

## Validación temporal (sin mirar el futuro)

Los pesos se ajustan con mayo a agosto y se miden con septiembre y octubre, meses que el ajuste nunca vio.

| Septiembre–octubre | etapa-5.2 | etapa-5.3 |
| --- | ---: | ---: |
| Fraude detectado | 75,3 % | 75,3 % |
| Legítimas retenidas | 155 | 116 (−25 %) |
| Legítimas desafiadas | 1.237 | 933 (−25 %) |
| Fricción a clientes legítimos | 3,4 % | 2,6 % |
| Legítimas retenidas ÷ retenidas | 37,3 % | 30,8 % |

## Qué cambió en etapa-5.3 y por qué

El objetivo fue bajar la fricción a clientes legítimos sin perder detección. Tres cambios, todos decididos con el
periodo de entrenamiento:

1. **Operaciones de bajo riesgo.** Recargas, pago de servicios y compra de tarjeta virtual no tienen ni un fraude
   en los seis meses, pero concentraban ~15 % de las retenciones de clientes legítimos. Ahora su decisión baja un
   escalón. Solo con esto, los falsos positivos bajaron de 22,0 % a 19,2 %.
2. **Monto alto frente al historial: retirado.** Lift 0,23 en entrenamiento: con esa señal activa hay *menos*
   fraude que en promedio. El fraude vacía el saldo (lift 7,1) en vez de superar el monto habitual.
3. **Hora atípica: de 0,10 a 0,05.** Lift 0,39: el fraude del reto no se concentra de madrugada.

**Probado y descartado:** una línea base por cliente (tipo de operación nuevo para el cliente, longitud del
historial). En los datos, el fraude casi nunca usa un tipo de operación nuevo para el cliente (9 de 494 casos en
validación), así que no separa mejor que las señales actuales.

## Escenarios de ataque

| Escenario (300 operaciones) | Resultado | Criterio |
| --- | --- | --- |
| Toma de cuenta: Tor + dispositivo nuevo + SIM + destino nuevo | 236 retenidas, 64 desafiadas, **0 aprobadas** | nunca se aprueba ✔ |
| Ráfaga de un mismo cliente | **270 rechazadas** por límite de tasa | el límite actúa ✔ |
| SIM swapping | 70 desafiadas, 12 retenidas | se verifica al cliente |
| Solo Tor (señal de origen) | 224 desafiadas, 13 retenidas | el origen solo, por sí mismo, no congela la plata |

Las 64 desafiadas de toma de cuenta son recargas y pagos de servicios: el dinero no sale hacia un tercero y el
código de verificación igual frena al atacante.

## Cómo reproducirlo

```bash
python 04_Sandbox_API/mock_api.py                     # sandbox del reto en :8080
go run ./cmd/intermediario                            # aegix en :8081
go run ./cmd/simulador -reiniciar -verificar -cantidad 121000 -lote 4 -concurrencia 4
go run ./cmd/simulador -reiniciar -verificar -escenario ato -cantidad 300   # también rafaga, sim, tor
python3 herramientas/calibrar_reglas.py 03_Datos/transacciones.csv          # validación temporal
```

`-verificar` termina con código 1 si no se cumple: sin errores, p99 < 300 ms, falsos positivos < 60 % y
detección ≥ 62,6 %.

## Límites

- Datos sintéticos y enriquecidos (1,41 % de fraude frente a una operación real mucho menor).
- Tor, proxy y país nuevo no están en los datos: sus pesos son criterio experto y no entran a estas cifras.
- La latencia medida no incluye la red de internet ni Vercel. Por el túnel se suman decenas de milisegundos,
  según dónde esté el cliente.
- El engaño con QR (39 casos aprobados en validación) casi no deja señales técnicas: es el principal hueco.

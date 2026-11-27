# Reporte de indicadores · Escudo Yuma (aegix)

Medido el 27 de noviembre de 2026 con las 120.972 transacciones del reto (1 de mayo a 31 de octubre de 2026),
enviadas por el simulador a aegix con 4 clientes en paralelo y calificadas por el sandbox del reto.

## Resultado principal

| Indicador | Motor actual (línea base) | etapa-5.3 | **etapa-5.4** |
| --- | ---: | ---: | ---: |
| Fraude detectado | 62,6 %, después de autorizar | 81,3 % | **86,5 %**, antes de autorizar |
| Monto de fraude protegido | 85,4 %, después de autorizar | 87,0 % | **89,0 %** |
| Falsos positivos (legítimas retenidas ÷ retenidas) | 89,0 % | 17,7 % | **22,5 %** |
| Clientes legítimos bloqueados | — | 0,25 % | **0,36 %** |
| Desafíos (código al cliente) | — | 3.138 | **4.884** |
| Retenciones para el analista | 9.687 alertas | 1.103 | **1.235** |
| Latencia p99 vista por el cliente | lotes cada 15 min | 3,6 ms | **3,5 ms** (límite 300 ms) |
| Rendimiento sostenido | — | 1.668 TPS | **1.750 TPS** (pico exigido 150) |
| Errores | — | 0 | **0** |

Detectado = fraude con decisión desafiar, retener o rechazar (definición del sandbox). La línea base sale de
`linea_base.py` del reto y alerta *después* de que el dinero salió; aegix decide *antes*.

**Por qué subieron los falsos positivos en la corrida de seis meses.** La señal nueva (comercio sin historial)
necesita saber qué comercios ya recibieron pagos. Al arrancar en mayo ningún comercio tiene historial y la señal
se activa de más; en julio la diferencia ya es mínima y en septiembre–octubre es nula:

| Mes | Legítimas retenidas 5.3 → 5.4 | Legítimas desafiadas 5.3 → 5.4 | Fraude detectado 5.3 → 5.4 |
| --- | ---: | ---: | ---: |
| Mayo | 31 → 107 | 381 → 1.437 | 82,1 % → 86,6 % |
| Junio | 37 → 77 | 391 → 861 | 83,7 % → 88,3 % |
| Julio | 65 → 73 | 419 → 533 | 82,2 % → 87,3 % |
| Agosto | 52 → 58 | 434 → 449 | 88,1 % → 91,8 % |
| Septiembre | 61 → 61 | 449 → 454 | 75,6 % → 84,0 % |
| Octubre | 55 → 55 | 484 → 486 | 75,0 % → 80,3 % |

En producción ese historial vendría del registro de comercios de Yuma, sin arranque en frío.

## Validación temporal (sin mirar el futuro)

Los pesos se ajustan con mayo a agosto y se miden con septiembre y octubre, meses que el ajuste nunca vio.

| Septiembre–octubre | etapa-5.2 | etapa-5.3 | etapa-5.4 |
| --- | ---: | ---: | ---: |
| Fraude detectado | 75,3 % | 75,3 % | **82,2 %** |
| Engaño con QR aprobado | 39 de 40 | 39 de 40 | **5 de 40** |
| Legítimas retenidas | 155 | 116 | 116 |
| Legítimas desafiadas | 1.237 | 933 | 940 |
| Fricción a clientes legítimos | 3,4 % | 2,6 % | 2,6 % |

## Qué cambió en etapa-5.4: el engaño con QR

Era el hueco principal: 39 de los 40 engaños con QR de la validación pasaban aprobados, porque no dejan señales
técnicas (mismo celular, misma clave, sin Tor). Al revisar los datos, los 38 comercios que usó el fraude **nunca
recibieron un pago legítimo**; los comercios reales reciben pagos de muchos clientes.

- **Señal nueva `comercio_desconocido`** (peso 0,25): el comercio recibió pagos de menos de 4 clientes distintos.
  Sumada a «destino nuevo» (0,10) alcanza el umbral de desafío (0,35): el cliente confirma con un código antes de
  pagar a un comercio que nadie conoce, y la razón le pide revisar que el QR sea el correcto.
- **Elegida con entrenamiento.** Probamos 1 a 8 clientes previos y pesos de 0,15 a 0,30; aplicada a todos los
  destinos subía la fricción al 9–17 %, así que quedó solo para comercios. Con 4 y 5 clientes el entrenamiento
  detecta igual; 4 molesta menos.
- Sola tiene lift 0,9 (porque en mayo marca comercios reales), pero cubre el 95 % del engaño con QR.

## Cambios de etapa-5.3 (fricción)

1. **Operaciones de bajo riesgo.** Recargas, pago de servicios y compra de tarjeta virtual no tienen ni un fraude
   en los seis meses. Su decisión baja un escalón.
2. **Monto alto frente al historial: retirado.** Lift 0,23 en entrenamiento: el fraude vacía el saldo (lift 7,1)
   en vez de superar el monto habitual.
3. **Hora atípica: de 0,10 a 0,05.** Lift 0,39: el fraude del reto no se concentra de madrugada.

**Probado y descartado:** una línea base por cliente (tipo de operación nuevo para el cliente). El fraude casi
nunca usa un tipo nuevo para el cliente (9 de 494 casos en validación).

## ¿Reglas o aprendizaje automático?

`herramientas/comparar_modelo.py` entrena una regresión logística con las mismas señales y la misma separación
temporal, y la compara con las reglas:

| Septiembre–octubre | Fraude detectado | Clientes legítimos con fricción |
| --- | ---: | ---: |
| **Reglas de aegix (etapa-5.4)** | **82,2 %** | **2,57 %** |
| Regresión logística, a igual fricción | 80,2 % | 2,37 % |
| Regresión logística, umbral fijado en entrenamiento | 86,2 % | 3,71 % |

A igual fricción, las reglas detectan más que el modelo y además se explican solas. El modelo solo detecta más si
se acepta molestar a más clientes. Sus pesos confirman las mismas señales (cuenta nueva, destino nuevo, dispositivo
nuevo, monto sobre saldo, comercio desconocido). El siguiente paso natural es usarlo como segunda opinión para el
analista, no como reemplazo.

## Escenarios de ataque

| Escenario (300 operaciones) | Resultado | Criterio |
| --- | --- | --- |
| Toma de cuenta: Tor + dispositivo nuevo + SIM + destino nuevo | 236 retenidas, 64 desafiadas, **0 aprobadas** | nunca se aprueba ✔ |
| Ráfaga de un mismo cliente | **270 rechazadas** por límite de tasa | el límite actúa ✔ |
| SIM swapping | 113 desafiadas, 15 retenidas | se verifica al cliente |
| Solo Tor (señal de origen) | 208 desafiadas, 34 retenidas | el origen solo no basta para retener |

Las 64 desafiadas de toma de cuenta son recargas y pagos de servicios: el dinero no sale hacia un tercero y el
código de verificación igual frena al atacante.

## Seguridad del despliegue público

- La billetera pide un código al ingresar y en cada transferencia; el código queda atado al monto y al destino.
- `api/codigo.js` limita el uso: 8 códigos por celular y 30 por IP cada 10 minutos, y 20 verificaciones por
  celular, para que nadie llene de notificaciones el celular ni pruebe códigos al azar.
- La consola pide contraseña; aegix no se expone a internet.

## Cómo reproducirlo

```bash
python 04_Sandbox_API/mock_api.py                     # sandbox del reto en :8080
go run ./cmd/intermediario                            # aegix en :8081
go run ./cmd/simulador -reiniciar -verificar -cantidad 121000 -lote 4 -concurrencia 4
go run ./cmd/simulador -reiniciar -verificar -escenario ato -cantidad 300   # también rafaga, sim, tor
python3 herramientas/calibrar_reglas.py 03_Datos/transacciones.csv          # validación temporal
python3 herramientas/comparar_modelo.py 03_Datos/transacciones.csv          # reglas frente a regresión logística
```

`-verificar` termina con código 1 si no se cumple: sin errores, p99 < 300 ms, falsos positivos < 60 % y
detección ≥ 62,6 %.

## Límites

- Datos sintéticos y enriquecidos (1,41 % de fraude frente a una operación real mucho menor).
- Tor, proxy y país nuevo no están en los datos: sus pesos son criterio experto y no entran a estas cifras.
- La latencia medida no incluye la red de internet ni Vercel. Por el túnel se suman decenas de milisegundos.
- El historial de comercios vive en memoria: tras reiniciar aegix, todo comercio es «desconocido» hasta que
  reciba pagos de 4 clientes.
- La ingeniería social (78 casos aprobados en validación) sigue siendo el fraude que más se
  escapa: la víctima opera desde su propio celular.

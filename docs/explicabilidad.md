# Cómo decide aegix y por qué

aegix no es una caja negra. Cada decisión es una suma de pesos que cualquiera puede rehacer a mano con
`config/reglas.yaml`, y cada respuesta trae las razones en el orden en que pesaron.

## 1. La cuenta

1. aegix calcula las señales de la operación (tabla de abajo). Cada señal está activa o no.
2. Suma el peso de las señales activas. El puntaje se corta en 1.
3. Compara con dos umbrales:

| Puntaje | Decisión | Qué pasa en la billetera |
| --- | --- | --- |
| menor que 0,35 | **aprobar** | la plata sale sin pasos extra |
| 0,35 a 0,65 | **desafiar** | se pide un código por SMS; si es correcto, sale |
| 0,65 o más, con una señal ajena al origen | **retener** | no sale; queda en la cola del analista |
| inválida o ráfaga | **rechazar** | 400 o 429, no se evalúa |

**Regla de la señal ajena.** Tor, proxy, país nuevo, departamento distinto y hora atípica describen *desde dónde
y cuándo* se conecta alguien, no *quién* es. Por sí solas nunca retienen: como mucho piden un código. Así un
cliente que viaja o usa una VPN no queda con la plata congelada.

**Operaciones de bajo riesgo.** En recargas, pago de servicios y compra de tarjeta virtual el dinero no sale hacia
un tercero, y en los seis meses de datos del reto no hay ni un fraude en ellas. Ahí la decisión baja un escalón:
lo que sería «retener» pide un código y lo que sería «desafiar» se aprueba.

**Si algo falla, no se aprueba a ciegas.** Si la evaluación supera 250 ms, aegix pide un desafío. Si aegix no
responde, la billetera no mueve dinero.

## 2. Las señales

Lift = cuántas veces más frecuente es el fraude cuando la señal está activa que en el promedio (1,41 %).
Medido sobre las 120.972 operaciones del reto.

| Señal | Peso | Lift | Qué mide | Por qué ese peso |
| --- | ---: | ---: | --- | --- |
| dispositivo nuevo | 0,50 | 18,2 | dispositivo registrado hace menos de 24 h | aparece en el 48 % del fraude; es la huella de la toma de cuenta |
| cambio de clave | 0,30 | 19,6 | clave cambiada en las últimas 24 h | segundo paso típico de la toma de cuenta |
| cambio de SIM | 0,25 | 22,1 | el operador reportó cambio de SIM en 48 h | SIM swapping: robo del SMS de verificación |
| salidas recientes | 0,25 | 33,8 | 2 o más operaciones del cliente en 10 minutos | el defraudador vacía la cuenta en ráfaga |
| monto sobre saldo | 0,20 | 7,1 | el monto es 75 % o más del saldo | vaciado de saldo |
| cuenta nueva | 0,15 | 10,9 | cuenta de menos de 30 días | las cuentas mula son el 35 % del fraude y todas tienen menos de 90 días |
| destino nuevo | 0,10 | 4,5 | primer envío a ese destino en 180 días | está en el 90 % del fraude, pero también en mucha operación normal |
| departamento distinto | 0,10 | 6,4 | la IP sale de otro departamento | señal de origen: no retiene sola |
| hora atípica | 0,05 | 0,5 | hora en la que el cliente casi nunca opera | en estos datos el fraude **no** se concentra de madrugada; se deja como desempate |
| Tor | 0,35 | — | IP de un nodo de salida Tor | criterio experto: no hay IP en los datos del reto |
| proxy o centro de datos | 0,10 | — | IP de nube o proxy | criterio experto |
| país nuevo | 0,15 | — | país fuera del historial del cliente | criterio experto |

**Lo que quitamos.** «Monto alto frente al historial del cliente» tenía peso 0,20, pero en los datos su lift es 0,2:
el fraude no supera el monto habitual, *vacía el saldo* (eso lo captura «monto sobre saldo»). Solo generaba
fricción, así que se retiró en la versión etapa-5.3. Lo decidimos con el periodo de entrenamiento (mayo a agosto,
lift 0,23), no con el de validación.

## 3. Tres casos de principio a fin

**Laura paga $50.000 a su contacto de siempre.** Ninguna señal → puntaje 0 → aprobar. Razón: «ninguna regla de
riesgo se activó».

**Toma de cuenta.** Tor (0,35) + dispositivo nuevo (0,50) + destino nuevo (0,10) = 0,95, y el dispositivo es
señal ajena al origen → retener. Razones en orden: «dispositivo nuevo», «conexión por un nodo de salida Tor»,
«destino nuevo».

**Cuenta mula.** Julián (cuenta de 21 días) envía todo su saldo a un número nuevo: cuenta nueva (0,15) + monto
sobre saldo (0,20) + destino nuevo (0,10) = 0,45 → desafiar. El código frena al defraudador sin bloquear al
cliente si es legítimo.

## 4. Quién ve qué

- **El cliente** ve la decisión y la razón principal en la billetera, en lenguaje llano.
- **El analista** ve en la consola el puntaje, todas las razones ordenadas por peso, el monto, el origen y la
  hora exacta, y puede **liberar** la operación o **confirmar fraude**.
- **La auditoría** guarda cada decisión con la versión de reglas que la tomó. El identificador de la operación
  se guarda como HMAC-SHA256, no en claro.

## 5. El ciclo de aprendizaje

Cada resolución del analista queda en la auditoría como una etiqueta: liberar = falso positivo, confirmar
fraude = fraude. La calibración las usa:

```bash
python3 herramientas/calibrar_reglas.py transacciones.csv --auditoria=datos/decisiones.jsonl --peso-analista=10
```

Cada caso resuelto vale por 10 operaciones del histórico en el entrenamiento; la validación sigue siendo el
histórico intacto. Si los nuevos pesos mejoran, se copian a `config/reglas.yaml` y aegix los carga en caliente,
sin reiniciar.

## 6. Accesibilidad y no discriminación

aegix no castiga a quien usa la billetera de otra manera.

- **Ninguna regla usa señales que se confundan con una discapacidad**: ni velocidad de escritura, ni tiempo en
  pantalla, ni uso de lector de pantalla, control por voz o teclado. Tampoco edad, región ni ingresos.
- **Preferencias de contacto, no diagnósticos.** En la billetera (Accesibilidad) el cliente puede elegir cómo quiere
  que lo contacten si un analista revisa su operación: mensaje de texto, llamada de voz, videollamada con intérprete
  de lengua de señas o chat, si prefiere lectura fácil y si lo acompaña una persona de apoyo (Ley 1996 de 2019).
  Viajan en `contexto.accesibilidad`; aegix las guarda para el analista y **no las usa para decidir**. Lo comprueba
  `TestAccesibilidadNoCambiaLaDecisionYLlegaAlAnalista`: mismas señales con y sin preferencias, mismo puntaje y
  misma decisión en los tres niveles de riesgo.
- **El analista las ve antes de actuar.** El caso muestra «Contacto accesible» y, en el detalle, cómo comunicarse.
- **La verificación no excluye.** Un desafío pide un código que dura 10 minutos y siempre se puede pedir otro (el
  límite es de seguridad y se puede extender, como pide WCAG 2.2.1); en pantalla se puede escuchar en voz alta, y en
  el celular llega como notificación que el lector de pantalla del teléfono lee. Quien opera con el celular de su persona de apoyo recibe un código, no un bloqueo (dispositivo nuevo solo
  no alcanza para retener).

## 7. Límites conocidos

- Los datos son sintéticos: los pesos responden a cómo se simuló el fraude del reto.
- Tor, proxy y país nuevo no se pueden calibrar con estos datos; sus pesos son criterio experto.
- Las etiquetas del analista solo existen para operaciones retenidas: corrigen los falsos positivos de esa zona,
  no el fraude que se aprobó.
- El engaño con QR (ingeniería social sobre un comercio falso) casi no deja señales técnicas: es el fraude que
  más se escapa.
- El historial por cliente (hora habitual, salidas recientes) vive en memoria y empieza de cero en cada arranque.

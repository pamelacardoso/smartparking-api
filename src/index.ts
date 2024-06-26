import mqtt from 'mqtt'
import { z } from 'zod'
import { prisma } from './config/db'
import { env } from './config/env'

const client = mqtt.connect(env.MQTT_URL)
const topic = env.MQTT_TOPIC

interface BrokerMessage {
    topic: string
    message: Buffer
    timestamp: Date
}

client.on('connect', () => {
    console.log('Connected to MQTT broker')
    console.log('*-'.repeat(20))
    client.subscribe(topic)
})

client.on('message', async (topic, message) => {
    try {
        processBrokerData({ message, topic, timestamp: new Date() })
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.error('Error processing message:', error.errors.map((e) => e.message))
        }
        else if (error instanceof SyntaxError) {
            console.error('Error processing message:', 'Invalid JSON format')
        } else {
            console.error('Error processing message:', error)
        }
    }
})


async function processBrokerData(brokerMessage: BrokerMessage) {
    const { topic, message, timestamp } = brokerMessage

    const schema = z.object({
        sensor: z.string({ message: 'Invalid sensor' }),
        status: z.boolean({ message: 'Invalid status' }).or(z.number().transform((v) => !!v)),
    })

    const { sensor, status } = schema.parse(JSON.parse(message.toString()))

    // Save to database
    const sensorRecord = await saveSensorData(sensor, status)
    console.table({ topic, sensor, status, timestamp: timestamp.toLocaleString() })

    // Save sensor movement
    const sensorId = sensorRecord.id
    await saveSensorMovement({ id: sensorId, status })
}

async function saveSensorData(sensor: string, status: boolean) {
    const record = await prisma.sensor.update({ where: { sensor }, data: { status } })
    return record
}

async function saveSensorMovement({ id, status }: { id: number, status: boolean }) {
    // Check if last record was an entry
    const lastRecord = await prisma.sensorMov.findFirst({
        where: { sensorId: id, completed: false },
        orderBy: { entryDateTime: 'desc' }
    })

    // Save sensor movement
    if (!lastRecord || !lastRecord.entryDateTime && status) {
        await prisma.sensorMov.create({ data: { sensorId: id } })
    } else {
        if (status) return // Ignore if status still true

        await prisma.sensorMov.update({
            where: { id: lastRecord?.id },
            data: { exitDateTime: new Date(), completed: true }
        })
    }
}


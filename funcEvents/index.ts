import { Context, HttpRequest } from '@azure/functions';
import { Logger } from '../src/shared/Logger';
import { ApiResponseBuilder } from '../src/shared/ApiResponse';
import { withApiHandler } from '../src/shared/apiHandler';
import { validateAuthToken } from '../src/shared/authHelper';
import { getPrismaClient } from '../src/config/PrismaClient';

const funcEvents = async (_context: Context, req: HttpRequest, log: Logger): Promise<unknown> => {
  const prisma = getPrismaClient();
  const method = req.method?.toUpperCase();
  const eventId = req.params?.id;

  // Helper para parsear campos JSON guardados como string
  const parseJson = (value: any) => {
    if (!value) return null;
    try {
      return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
      return value;
    }
  };

  // GET público: listar o obtener por id
  if (method === 'GET') {
    try {
      log.logInfo('Processing GET events (public)', { eventId });

      if (eventId) {
        const event = await prisma.event.findUnique({ where: { id: Number(eventId) } });
        if (!event) return ApiResponseBuilder.error('Event not found', 404);
        return ApiResponseBuilder.success(
          {
            ...event,
            organizers: parseJson(event.organizers),
            attachments: parseJson(event.attachments),
            tags: parseJson(event.tags),
          },
          'Event retrieved'
        );
      }

      // Lista con filtros simples (category, status)
      const where: any = {};
      if (req.query.category) where.category = req.query.category;
      if (req.query.status) where.status = req.query.status;

      const events = await prisma.event.findMany({ where, orderBy: { startDate: 'asc' } });

      const mapped = events.map((e) => ({
        ...e,
        organizers: parseJson(e.organizers),
        attachments: parseJson(e.attachments),
        tags: parseJson(e.tags),
      }));

      return ApiResponseBuilder.success({ count: mapped.length, events: mapped }, 'Events list');
    } catch (error: any) {
      log.logError('Error fetching events', { error: error.message });
      return ApiResponseBuilder.error('Error fetching events', 500);
    }
  }

  // Métodos que requieren autenticación
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader) {
    log.logError('Authentication failed: Missing authorization header');
    return ApiResponseBuilder.error('Unauthorized: Missing authorization header', 401);
  }

  try {
    const token = validateAuthToken(authHeader);
    const { verifyToken } = await import('../src/shared/jwtHelper');
    const userPayload = verifyToken(token);

    log.logInfo('User authenticated for events endpoint', {
      userId: userPayload.id,
      email: userPayload.email,
    });

    switch (method) {
      case 'POST': {
        // Crear nuevo evento
        const body = req.body || {};
        if (!body.title || !body.startDate) {
          return ApiResponseBuilder.validationError(['`title` and `startDate` are required']);
        }

        const created = await prisma.event.create({
          data: {
            title: body.title,
            description: body.description || null,
            startDate: new Date(body.startDate),
            endDate: body.endDate ? new Date(body.endDate) : null,
            location: body.location || null,
            category: body.category || null,
            status: body.status || 'scheduled',
            maxAttendees: body.maxAttendees || null,
            organizers: body.organizers ? JSON.stringify(body.organizers) : null,
            attachments: body.attachments ? JSON.stringify(body.attachments) : null,
            tags: body.tags ? JSON.stringify(body.tags) : null,
          },
        });

        return ApiResponseBuilder.success(
          {
            ...created,
            organizers: parseJson(created.organizers),
            attachments: parseJson(created.attachments),
            tags: parseJson(created.tags),
          },
          'Event created'
        );
      }

      case 'PUT': {
        if (!eventId)
          return ApiResponseBuilder.validationError(['Event ID is required for update']);
        const body = req.body || {};

        const updated = await prisma.event.update({
          where: { id: Number(eventId) },
          data: {
            title: body.title,
            description: body.description,
            startDate: body.startDate ? new Date(body.startDate) : undefined,
            endDate: body.endDate ? new Date(body.endDate) : undefined,
            location: body.location,
            category: body.category,
            status: body.status,
            maxAttendees: body.maxAttendees,
            organizers: body.organizers ? JSON.stringify(body.organizers) : undefined,
            attachments: body.attachments ? JSON.stringify(body.attachments) : undefined,
            tags: body.tags ? JSON.stringify(body.tags) : undefined,
          },
        });

        return ApiResponseBuilder.success(
          {
            ...updated,
            organizers: parseJson(updated.organizers),
            attachments: parseJson(updated.attachments),
            tags: parseJson(updated.tags),
          },
          'Event updated'
        );
      }

      case 'DELETE': {
        if (!eventId)
          return ApiResponseBuilder.validationError(['Event ID is required for deletion']);
        await prisma.event.delete({ where: { id: Number(eventId) } });
        return ApiResponseBuilder.success(null, 'Event deleted');
      }

      default:
        return ApiResponseBuilder.validationError([
          `HTTP method ${method} not supported for events`,
        ]);
    }
  } catch (error: any) {
    const msg = error instanceof Error ? error.message : 'Authentication failed';
    log.logError('Error in events handler', { error: msg });
    if (msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('invalid token')) {
      return ApiResponseBuilder.error('Unauthorized: Invalid or expired token', 401);
    }
    return ApiResponseBuilder.error(`Error: ${msg}`, 500);
  }
};

export default withApiHandler(funcEvents);

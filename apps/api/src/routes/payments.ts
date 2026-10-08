import { Router, Response } from 'express';
import { prisma } from '@dct-crm/db';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/authorization';
import { auditLog } from '../middleware/audit';
import { applyScope, canAccessBooking, getScopeClause } from '../services/recordAccess';

const router = Router();

router.use(authenticate);

const paymentSchema = z.object({
  bookingId: z.string(),
  amount: z.number().min(0.01),
  status: z.enum(['PENDING', 'VERIFIED', 'REJECTED', 'PARTIAL', 'COMPLETED']).optional(),
  paymentDate: z.string().datetime().optional(),
  reference: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

const updatePaymentSchema = paymentSchema.partial();

router.get('/', authorize('Payment', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId } = req.user!;
    const {
      page = 1,
      limit = 20,
      bookingId,
      status,
      minAmount,
      maxAmount,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    let where: any = { tenantId };
    if (bookingId) where.bookingId = bookingId;
    if (status) where.status = status;
    if (minAmount) where.amount = { ...where.amount, gte: Number(minAmount) };
    if (maxAmount) where.amount = { ...where.amount, lte: Number(maxAmount) };
    if (startDate && endDate) {
      where.paymentDate = {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string),
      };
    }
    where = applyScope(where, await getScopeClause(req.user!, 'payment'));

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { [sortBy as string]: sortOrder },
        include: {
          booking: {
            select: {
              id: true,
              number: true,
              unit: { select: { number: true } },
              lead: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
      prisma.payment.count({ where }),
    ]);

    res.json({
      success: true,
      data: payments,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch payments' });
  }
});

router.get('/:id', authorize('Payment', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId } = req.user!;

    const payment = await prisma.payment.findFirst({
      where: applyScope(
        { id: req.params.id, tenantId },
        await getScopeClause(req.user!, 'payment'),
      ),
      include: {
        booking: {
          select: {
            id: true,
            number: true,
            unit: { select: { number: true } },
            project: { select: { name: true } },
            lead: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }

    res.json({ success: true, data: payment });
  } catch (error) {
    console.error('Get payment error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch payment' });
  }
});

router.post('/', authorize('Payment', 'create'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId, id: userId } = req.user!;
    const data = paymentSchema.parse(req.body);

    const booking = await prisma.booking.findFirst({
      where: { id: data.bookingId, tenantId },
    });

    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }
    if (req.user!.profileName === 'Sales' && !(await canAccessBooking(req.user!, booking))) {
      return res.status(403).json({ success: false, error: 'You do not have access to the linked booking' });
    }

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          tenantId,
          bookingId: data.bookingId,
          amount: data.amount,
          status: data.status || 'PENDING',
          paymentDate: data.paymentDate ? new Date(data.paymentDate) : new Date(),
          reference: data.reference,
          notes: data.notes,
        },
        include: {
          booking: { select: { id: true, number: true } },
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          bookingId: data.bookingId,
          action: 'CREATE',
          objectType: 'Payment',
          objectId: created.id,
          newValues: { amount: data.amount, bookingId: data.bookingId },
        },
      });
      return created;
    });

    res.status(201).json({ success: true, data: payment });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: error.errors[0].message });
    }
    console.error('Create payment error:', error);
    res.status(500).json({ success: false, error: 'Failed to create payment' });
  }
});

router.put('/:id', authorize('Payment', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId, id: userId } = req.user!;

    const existing = await prisma.payment.findFirst({
      where: applyScope(
        { id: req.params.id, tenantId },
        await getScopeClause(req.user!, 'payment'),
      ),
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }

    if (existing.status === 'COMPLETED') {
      return res.status(400).json({ success: false, error: 'Cannot update completed payment' });
    }

    const data = updatePaymentSchema.parse(req.body);
    if (data.bookingId && data.bookingId !== existing.bookingId) {
      const booking = await prisma.booking.findFirst({
        where: { id: data.bookingId, tenantId },
      });
      if (!booking) {
        return res.status(404).json({ success: false, error: 'Booking not found' });
      }
      if (req.user!.profileName === 'Sales' && !(await canAccessBooking(req.user!, booking))) {
        return res.status(403).json({ success: false, error: 'You do not have access to the linked booking' });
      }
    }

    const updateData: any = { ...data };
    if (data.paymentDate) updateData.paymentDate = new Date(data.paymentDate);

    const payment = await prisma.payment.update({
      where: { id: req.params.id },
      data: updateData,
    });

    await auditLog(tenantId, userId, 'UPDATE', 'Payment', payment.id, existing, payment);

    res.json({ success: true, data: payment });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: error.errors[0].message });
    }
    console.error('Update payment error:', error);
    res.status(500).json({ success: false, error: 'Failed to update payment' });
  }
});

router.patch('/:id/verify', authorize('Payment', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId, id: userId } = req.user!;

    const existing = await prisma.payment.findFirst({
      where: applyScope(
        { id: req.params.id, tenantId },
        await getScopeClause(req.user!, 'payment'),
      ),
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }

    if (existing.status === 'COMPLETED') {
      return res.status(400).json({ success: false, error: 'Payment is already completed' });
    }

    const payment = await prisma.payment.update({
      where: { id: req.params.id },
      data: {
        status: 'COMPLETED',
        verifiedAt: new Date(),
      },
    });

    await auditLog(tenantId, userId, 'UPDATE', 'Payment', payment.id, existing, { status: 'COMPLETED' });

    res.json({ success: true, data: payment });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({ success: false, error: 'Failed to verify payment' });
  }
});

router.patch(['/:id/refund', '/:id/reject'], authorize('Payment', 'edit'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId, id: userId } = req.user!;
    const { notes, reason } = req.body;
    const rejectReason = notes || reason;

    const existing = await prisma.payment.findFirst({
      where: { id: req.params.id, tenantId },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }

    if (existing.status === 'REJECTED') {
      return res.status(400).json({ success: false, error: 'Payment is already refunded' });
    }

    const payment = await prisma.payment.update({
      where: { id: req.params.id },
      data: {
        status: 'REJECTED',
        notes: rejectReason || existing.notes,
      },
    });

    await auditLog(tenantId, userId, 'UPDATE', 'Payment', payment.id, existing, { status: 'REJECTED', notes: rejectReason });

    res.json({ success: true, data: payment });
  } catch (error) {
    console.error('Refund payment error:', error);
    res.status(500).json({ success: false, error: 'Failed to refund payment' });
  }
});

router.delete('/:id', authorize('Payment', 'delete'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId, id: userId } = req.user!;

    const existing = await prisma.payment.findFirst({
      where: { id: req.params.id, tenantId },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }

    if (existing.status === 'COMPLETED') {
      return res.status(400).json({ success: false, error: 'Cannot delete completed payment' });
    }

    await prisma.payment.delete({ where: { id: req.params.id } });

    await auditLog(tenantId, userId, 'DELETE', 'Payment', existing.id, existing, null);

    res.json({ success: true, data: null });
  } catch (error) {
    console.error('Delete payment error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete payment' });
  }
});

export default router;

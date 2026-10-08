import { Router, Response } from 'express';
import { prisma } from '@dct-crm/db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/authorization';
import { canAccessLead } from '../services/recordAccess';
import { getEnquiryById } from '../services/enquiryService';

const router = Router();

router.use(authenticate);

router.get('/:id', authorize('Enquiry', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const enquiry = await getEnquiryById(
      req.user!.isSuperAdmin ? undefined : req.user!.tenantId,
      req.params.id,
    );
    if (!enquiry) return res.status(404).json({ success: false, error: 'Enquiry not found' });
    if (!(await canAccessLead(req.user!, enquiry.lead))) {
      return res.status(403).json({ success: false, error: 'You do not have access to this enquiry' });
    }

    const [createdBy, updatedBy] = await Promise.all([
      enquiry.createdById
        ? prisma.user.findFirst({
            where: { id: enquiry.createdById, tenantId: enquiry.tenantId },
            select: { id: true, firstName: true, lastName: true },
          })
        : null,
      enquiry.updatedById
        ? prisma.user.findFirst({
            where: { id: enquiry.updatedById, tenantId: enquiry.tenantId },
            select: { id: true, firstName: true, lastName: true },
          })
        : null,
    ]);
    return res.json({
      success: true,
      data: {
        ...enquiry,
        createdBy,
        lastModifiedBy: updatedBy,
      },
    });
  } catch (error) {
    console.error('Get enquiry error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch enquiry' });
  }
});

export default router;

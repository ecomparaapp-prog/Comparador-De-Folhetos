import { Router, type IRouter } from "express";
import healthRouter from "./health";
import pricesRouter from "./prices";

const router: IRouter = Router();

router.use(healthRouter);
router.use(pricesRouter);

export default router;

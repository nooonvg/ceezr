/**
 * الغرض: منفذُ أحداثِ الرحلةِ للإنتاجِ — ADR 0287. يُفصَلُ في وحدتِه كي يبقى
 *   ناقلُ `socket.io-client` داخلَ قطعةِ شاشةِ الرحلةِ المؤجَّلةِ لا في الحزمةِ
 *   الأولى (حارسُ أولِ رسمٍ F1-09).
 * الحالة: منفَّذٌ فعليّاً.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/active
 */
import {
  productionChannelBaseUrl,
  productionRideChannelTransport,
  productionSessionReader,
} from "../../../services/production-ride-channel.ts";
import { type TripEventsApi, type TripEventsChannelDeps, tripEventsViaApi } from "./trip-events.ts";

export const PRODUCTION_TRIP_EVENTS: {
  readonly api: TripEventsApi;
  readonly channel: TripEventsChannelDeps;
} = {
  api: tripEventsViaApi,
  channel: {
    transport: productionRideChannelTransport,
    sessions: productionSessionReader,
    baseUrl: productionChannelBaseUrl(),
  },
};

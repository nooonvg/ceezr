// استكشاف: تسجيل سائق وزبون وطلب مشوار واحد وطباعة ما يصل للمحاكي.
const BASE = "http://127.0.0.1:54300";
const MOCK = "http://127.0.0.1:58090";
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
let uid = Math.floor(Date.now() / 1000) * 10;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const msg = (c: number, b: Record<string, unknown>) => ({
  update_id: ++uid,
  message: {
    message_id: uid,
    date: Math.floor(Date.now() / 1000),
    chat: { id: c, type: "private" },
    from: { id: c, is_bot: false, first_name: "t", language_code: "ar" },
    ...b,
  },
});
const cb = (c: number, data: string, chat = c) => ({
  update_id: ++uid,
  callback_query: {
    id: String(uid),
    data,
    chat_instance: "x",
    from: { id: c, is_bot: false, first_name: "t", language_code: "ar" },
    message: {
      message_id: 1,
      date: 0,
      chat: { id: chat, type: chat < 0 ? "supergroup" : "private" },
    },
  },
});
async function post(bot: string, u: unknown) {
  const r = await fetch(`${BASE}/webhook/telegram/${bot}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET },
    body: JSON.stringify(u),
  });
  return r.status;
}
let cursor = 0;
async function dump(label: string) {
  await sleep(Number(process.env.W ?? 3000));
  const j = (await (await fetch(`${MOCK}/events?after=${cursor}`)).json()) as {
    events: Array<{
      seq: number;
      bot: string;
      method: string;
      chat_id: string;
      text?: string;
      cbs?: string[];
    }>;
  };
  console.log(`--- ${label}`);
  for (const e of j.events) {
    cursor = e.seq;
    console.log(
      e.bot,
      e.method,
      e.chat_id,
      JSON.stringify(e.text ?? "").slice(0, 140),
      e.cbs?.join(","),
    );
  }
}
const cities = JSON.parse(process.env.CITIES ?? "[]") as Array<Record<string, unknown>>;
const D = 8100001,
  _R = 8200001;
const _JED = { lat: 21.5433, lng: 39.1728 };
await post("driver", msg(D, { text: "/start" }));
await dump("d start");
await post("driver", msg(D, { text: "سائق تجريبي" }));
await dump("d name");
await post(
  "driver",
  msg(D, { contact: { user_id: D, phone_number: "+966500000001", first_name: "t" } }),
);
await dump("d contact");
await post("driver", cb(D, `city:${cities.JED}`));
await dump("d city");
await post("driver", cb(D, `service:transport`));
await dump("d svc");
await post("driver", cb(D, `vehicle:sedan`));
await dump("d veh");
await post("driver", msg(D, { text: "أ ب ج 1234" }));
await dump("d plate");
await post("driver", msg(D, { text: "1000000001" }));
await dump("d id");
await post(
  "driver",
  msg(D, {
    photo: [
      { file_id: "p_t", file_unique_id: "pu_t", width: 90, height: 90 },
      { file_id: "p1", file_unique_id: "pu1", width: 800, height: 600 },
    ],
  }),
);
await dump("d photo");

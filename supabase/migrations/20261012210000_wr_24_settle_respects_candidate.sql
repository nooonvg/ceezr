-- migration-phase: expand
-- =============================================================================
-- `WR-24` — اتفاقُ القروبِ لا يتجاوزُ مرشَّحًا محجوزًا لقرارِ الراكب.
--
-- **المقيسُ (قاعدةٌ محليّةٌ من `main`، `tests/integration/wr-24-concurrent-races.test.ts` ٧ب):**
-- سائقٌ مشتركٌ قبلَ العرضَ فصارَ مرشَّحًا ينتظرُ قرارَ الراكب (`WR-09`)، ثمَّ ضغطَ الراكبُ «تم
-- الاتفاق» مع سائقِ القروب: `settle_unsubscribed_negotiation` أسندَت الطلبَ لسائقِ القروب، وألغت
-- عرضَ المرشَّح، وتركت `orders.candidate_driver_id` قائمًا على طلبٍ مُسنَدٍ لغيرِه. فالراكبُ يرى
-- بطاقةَ مرشَّحٍ لطلبٍ أُسنِد، والمرشَّحُ لا يُخطَرُ إلّا حينَ يحرّرُه الشوطُ بنتيجةِ «انتهت المهلة».
--
-- **القرار:** الصورةُ السابقةُ (`20260906020000`) حرفًا، مع فرقٍ واحدٍ بعدَ قفلِ الطلب: مرشَّحٌ
-- حيٌّ ⇒ `ORDER_HELD` بلا كتابة، كما في `claim_ride`؛ ومرشَّحٌ فائتٌ ⇒ `release_order_candidate`
-- بـ`EXPIRED` ثمَّ الاتفاق. والدورةُ تبقى «negotiating» فيعودُ الزرُّ يعملُ بعدَ قرارِ الراكب.
--
-- **التوافق:** المُنادي (`negotiation-adapters.ts`) يقرأُ `error` نصًّا فيصيرُ `reason`، والبوتُ
-- يقولُ للراكبِ إنَّ عندَه سائقًا ينتظرُ قرارَه. والرجوعُ بإعادةِ الصورةِ السابقة.
-- =============================================================================

create or replace function settle_unsubscribed_negotiation(p_negotiation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_neg    unsubscribed_negotiations%rowtype;
  v_claim  unsubscribed_claims%rowtype;
  v_order  orders%rowtype;
  v_driver drivers%rowtype;
  v_now    timestamptz := now();
  v_queued integer := 0;
begin
  select * into v_neg
    from unsubscribed_negotiations
   where id = p_negotiation_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NEGOTIATION_NOT_FOUND');
  end if;
  if v_neg.status <> 'negotiating' or v_neg.active_claim_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_NEGOTIATING');
  end if;

  select * into v_order
    from orders
   where id = v_neg.order_id and status = 'searching'
     for update skip locked;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_CLAIMABLE');
  end if;

  -- `WR-24`: مرشَّحٌ حيٌّ لقرارِ الراكبِ (`WR-09`) يحجزُ الطلبَ عن اتفاقِ القروبِ كما يحجزُه
  -- عن `claim_ride`، فلا يُسنَدُ الطلبُ لسائقٍ ومرشَّحٌ آخرُ قائمٌ على البطاقة. والفائتُ يُحرَّرُ
  -- كسولًا بإشعارِه الوحيدِ (`EXPIRED`) ثمَّ يُتابَعُ الاتفاق.
  if v_order.candidate_driver_id is not null then
    if v_order.candidate_expires_at > v_now then
      return jsonb_build_object('ok', false, 'error', 'ORDER_HELD',
                                'expires_at', v_order.candidate_expires_at);
    end if;
    perform release_order_candidate(v_order.id, 'EXPIRED');
  end if;

  select * into v_claim from unsubscribed_claims where id = v_neg.active_claim_id;
  select * into v_driver from drivers where id = v_claim.driver_id;

  update unsubscribed_claims
     set outcome = 'agreed', closed_at = v_now
   where id = v_claim.id;

  -- من لم يصل دوره لا يبقى معلَّقاً: الاتفاق يُغلق الدورة كلّها
  update unsubscribed_claims
     set outcome = 'cancelled', closed_at = v_now
   where negotiation_id = p_negotiation_id and outcome = 'waiting';

  update unsubscribed_negotiations
     set status = 'agreed', settled_at = v_now, negotiate_deadline = null
   where id = p_negotiation_id;

  -- أي عرض معلَّق في المسار المشترك يُلغى: لا مسارا إسناد لطلب واحد
  update order_offers
     set status = 'cancelled', responded_at = v_now
   where order_id = v_neg.order_id and status = 'pending';

  update orders
     set status = 'matched', assigned_driver_id = v_claim.driver_id, matched_at = v_now
   where id = v_neg.order_id;

  v_queued := enqueue_negotiation_notification(
    v_neg.city_id, 'negotiation_agreed', v_claim.id
  );

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_neg.city_id, v_driver.user_id, 'unsubscribed.agreed', 'order', v_neg.order_id,
          jsonb_build_object('negotiation_id', p_negotiation_id, 'claim_id', v_claim.id,
                             'driver_id', v_claim.driver_id, 'position', v_claim.position,
                             'cycle', v_neg.cycle));

  return jsonb_build_object('ok', true, 'order_id', v_neg.order_id,
                            'notifications_queued', v_queued,
                            'driver_id', v_claim.driver_id, 'matched_at', v_now);
end;
$$;

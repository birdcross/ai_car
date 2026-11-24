insert into public.manual_chunks (id, make_key, model_key, model_year, title, content, source_url)
values
    ('hyundai-ioniq6-2025-1', '현대', '아이오닉6', 2025, '동시 점등', '파워다운 표시등과 서비스 경고등이 함께 켜지면 현대차 서비스센터에서 차량 점검을 받으세요.', 'https://ownersmanual.hyundai.com/full_webhelp/CE1/2025/ko_KR/id23C4LH00HL7.html'),
    ('hyundai-ioniq6-2025-2', '현대', '아이오닉6', 2025, '파워다운 표시등', '고전압 부품 보호를 위해 출력이 제한될 때 표시됩니다. 충전량이나 구동계 온도 등이 관련될 수 있습니다. 다른 경고등이 함께 표시되는지 확인하세요.', 'https://ownersmanual.hyundai.com/full_webhelp/CE1/2025/ko_KR/id23C4LH00HL7.html'),
    ('hyundai-ioniq6-2025-3', '현대', '아이오닉6', 2025, '저압 타이어 경고등', '타이어 공기압이 낮을 때 표시될 수 있습니다. 안전한 곳에서 타이어 상태와 공기압을 확인하세요. 표시등이 약 1분 깜빡인 뒤 켜지면 시스템 점검이 필요할 수 있습니다.', 'https://ownersmanual.hyundai.com/full_webhelp/CE1/2025/ko_KR/id23C4LH00HL7.html'),
    ('hyundai-ioniq6-2025-4', '현대', '아이오닉6', 2025, '서비스 경고등', '전기차 제어 시스템 등에 이상이 있을 때 켜질 수 있습니다. 주행 중 켜지거나 시동 후에도 지속되면 현대차 서비스센터에서 점검받으세요.', 'https://ownersmanual.hyundai.com/full_webhelp/CE1/2025/ko_KR/id23C4LH00HL7.html')
on conflict (id) do nothing;
